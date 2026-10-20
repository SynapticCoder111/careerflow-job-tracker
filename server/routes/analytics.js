const express = require("express");
const Application = require("../models/Application");
const Interview = require("../models/Interview");
const { requireAuth } = require("../middleware/auth");
const { startOfTodayUTC } = require("../utils/dateOnly");

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/analytics/summary
 *
 * Every rate states its denominator explicitly. A zero denominator returns
 * null rather than a misleading 0% or NaN.
 */
router.get("/summary", async function (req, res) {
  try {
    const applications = await Application.find({ userId: req.user._id }).lean();

    const total = applications.length;
    const byStatus = {};
    const bySource = {};
    const byWorkMode = {};
    const byEmploymentType = {};
    const byPriority = {};

    applications.forEach((a) => {
      if (a.status) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      if (a.jobSource) bySource[a.jobSource] = (bySource[a.jobSource] || 0) + 1;
      if (a.workMode) byWorkMode[a.workMode] = (byWorkMode[a.workMode] || 0) + 1;
      if (a.employmentType)
        byEmploymentType[a.employmentType] = (byEmploymentType[a.employmentType] || 0) + 1;
      if (a.priority) byPriority[a.priority] = (byPriority[a.priority] || 0) + 1;
    });

    // "Applied" denominator — any record that progressed past Bookmarked.
    const applied = applications.filter((a) => a.status !== "Bookmarked").length;
    const interviewCount = byStatus.Interview || 0;
    const offerCount = byStatus.Offer || 0;
    const assessmentCount = byStatus.Assessment || 0;
    const rejectedCount = byStatus.Rejected || 0;
    const responded = assessmentCount + interviewCount + offerCount;

    // Average days from application to interview (only where both dates exist).
    const toInterview = applications
      .filter((a) => a.applicationDate && a.interviewDate)
      .map((a) => (new Date(a.interviewDate) - new Date(a.applicationDate)) / 86400000)
      .filter((d) => d >= 0);

    // Date-only values are stored at UTC midnight, so "today" must be the UTC
    // boundary; using local midnight would misclassify records by up to a day.
    const today = startOfTodayUTC();
    const weekAhead = new Date(today);
    weekAhead.setUTCDate(today.getUTCDate() + 7);

    const followUpsScheduled = applications.filter((a) => !!a.followUpDate).length;
    const followUpsPastDue = applications.filter((a) => {
      if (!a.followUpDate) return false;
      return new Date(a.followUpDate) < today;
    }).length;

    const interviewTotal = await Interview.countDocuments({ userId: req.user._id });

    function rate(numerator, denominator) {
      if (!denominator) return null;
      return Math.round((numerator / denominator) * 10000) / 100;
    }

    res.json({
      success: true,
      data: {
        totalApplications: total,
        applied,
        inProgress: applications.filter((a) =>
          ["Applied", "Assessment", "Interview"].includes(a.status)
        ).length,
        interviewsScheduled: interviewCount,
        interviewRounds: interviewTotal,
        offersReceived: offerCount,
        responded,
        rejected: rejectedCount,
        followUpsDue: applications.filter((a) => {
          if (!a.followUpDate) return false;
          const d = new Date(a.followUpDate);
          return d < weekAhead;
        }).length,

        interviewConversionRate: rate(interviewCount, applied),
        interviewConversionDenominator: applied,
        offerConversionRate: rate(offerCount, applied),
        offerConversionDenominator: applied,
        responseRate: rate(responded, applied),
        responseDenominator: applied,

        averageDaysToInterview: toInterview.length
          ? Math.round(
              (toInterview.reduce((s, d) => s + d, 0) / toInterview.length) * 10
            ) / 10
          : null,
        averageDaysToInterviewSampleSize: toInterview.length,

        followUpsScheduled,
        followUpsPastDue,

        byStatus,
        bySource,
        byWorkMode,
        byEmploymentType,
        byPriority,
      },
    });
  } catch (err) {
    console.error("GET /api/analytics/summary error:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to calculate analytics summary",
    });
  }
});

module.exports = router;
