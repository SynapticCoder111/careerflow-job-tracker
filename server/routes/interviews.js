const express = require("express");
const mongoose = require("mongoose");
const Interview = require("../models/Interview");
const Application = require("../models/Application");
const { requireAuth } = require("../middleware/auth");
const { serializeDateOnly, startOfTodayUTC } = require("../utils/dateOnly");

const router = express.Router();

/**
 * All interview routes require an authenticated user and are scoped to that
 * user's records.
 */
router.use(requireAuth);

function normalizeDoc(doc) {
  if (!doc) return null;
  const ret = serializeDateOnly(doc);
  ret.id = ret._id ? ret._id.toString() : undefined;
  delete ret._id;
  delete ret.__v;
  return ret;
}

function validationDetails(err) {
  return Object.fromEntries(
    Object.entries(err.errors).map(([key, val]) => [key, val.message])
  );
}

/* GET /api/interviews */
router.get("/", async function (req, res) {
  try {
    const { applicationId, outcome, interviewType, upcoming } = req.query;
    const filter = { userId: req.user._id };

    if (applicationId) {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        return res.status(400).json({ success: false, message: "Invalid application ID" });
      }
      filter.applicationId = applicationId;
    }
    if (outcome) filter.outcome = outcome;
    if (interviewType) filter.interviewType = interviewType;
    if (upcoming === "true") filter.interviewDate = { $gte: startOfTodayUTC() };

    const interviews = await Interview.find(filter).sort({ interviewDate: 1 }).lean();

    res.json({
      success: true,
      data: interviews.map(normalizeDoc),
      total: interviews.length,
    });
  } catch (err) {
    console.error("GET /api/interviews error:", err.message);
    res.status(500).json({ success: false, message: "Failed to retrieve interviews" });
  }
});

/* GET /api/interviews/:id */
router.get("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid interview ID" });
    }
    const interview = await Interview.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();
    if (!interview) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }
    res.json({ success: true, data: normalizeDoc(interview) });
  } catch (err) {
    console.error("GET /api/interviews/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to retrieve interview" });
  }
});

/* POST /api/interviews */
router.post("/", async function (req, res) {
  try {
    const { applicationId } = req.body;
    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Application ID is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      return res.status(400).json({ success: false, message: "Invalid application ID" });
    }

    const parent = await Application.findOne({
      _id: applicationId,
      userId: req.user._id,
    }).lean();
    if (!parent) {
      return res.status(404).json({ success: false, message: "Linked application not found" });
    }

    const payload = { ...req.body, userId: req.user._id, applicationId };
    delete payload.id;
    delete payload._id;
    delete payload.__v;

    const interview = new Interview(payload);
    await interview.save();

    res.status(201).json({
      success: true,
      message: "Interview created successfully",
      data: normalizeDoc(interview.toObject()),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationDetails(err),
      });
    }
    console.error("POST /api/interviews error:", err.message);
    res.status(500).json({ success: false, message: "Failed to create interview" });
  }
});

/* PUT /api/interviews/:id */
router.put("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid interview ID" });
    }

    const payload = { ...req.body };
    delete payload.applicationId; // the parent link is immutable
    delete payload.userId;
    delete payload.id;
    delete payload._id;
    delete payload.__v;

    const interview = await Interview.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      payload,
      { returnDocument: "after", runValidators: true }
    ).lean();

    if (!interview) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }

    res.json({
      success: true,
      message: "Interview updated successfully",
      data: normalizeDoc(interview),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationDetails(err),
      });
    }
    console.error("PUT /api/interviews/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update interview" });
  }
});

/* PATCH /api/interviews/:id/checklist/:index — toggle one checklist item */
router.patch("/:id/checklist/:index", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid interview ID" });
    }
    const index = parseInt(req.params.index, 10);
    if (Number.isNaN(index) || index < 0) {
      return res.status(400).json({ success: false, message: "Invalid checklist index" });
    }

    const interview = await Interview.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!interview) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }
    if (!interview.preparationChecklist || !interview.preparationChecklist[index]) {
      return res.status(404).json({ success: false, message: "Checklist item not found" });
    }

    interview.preparationChecklist[index].done =
      typeof req.body.done === "boolean"
        ? req.body.done
        : !interview.preparationChecklist[index].done;
    await interview.save();

    res.json({
      success: true,
      message: "Checklist updated successfully",
      data: normalizeDoc(interview.toObject()),
    });
  } catch (err) {
    console.error("PATCH /api/interviews/:id/checklist error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update checklist" });
  }
});

/* DELETE /api/interviews/:id */
router.delete("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid interview ID" });
    }
    const interview = await Interview.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!interview) {
      return res.status(404).json({ success: false, message: "Interview not found" });
    }
    res.json({ success: true, message: "Interview deleted successfully" });
  } catch (err) {
    console.error("DELETE /api/interviews/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete interview" });
  }
});

module.exports = router;
