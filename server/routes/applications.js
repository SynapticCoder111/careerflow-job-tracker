const express = require("express");
const mongoose = require("mongoose");
const Application = require("../models/Application");
const Interview = require("../models/Interview");
const { requireAuth } = require("../middleware/auth");
const { serializeDateOnly } = require("../utils/dateOnly");

const router = express.Router();

/**
 * All application routes require an authenticated user and are scoped to
 * that user's records. A user can never read or modify another user's data.
 */
router.use(requireAuth);

// Normalize a lean Mongoose document: expose `id`, remove `_id` and `__v`,
// and serialise calendar dates as YYYY-MM-DD (see utils/dateOnly.js).
function normalizeDoc(doc) {
  if (!doc) return null;
  const ret = serializeDateOnly(doc);
  ret.id = ret._id ? ret._id.toString() : undefined;
  delete ret._id;
  delete ret.__v;
  return ret;
}

function normalizeDocs(docs) {
  return Array.isArray(docs) ? docs.map(normalizeDoc) : docs;
}

function validationDetails(err) {
  return Object.fromEntries(
    Object.entries(err.errors).map(([key, val]) => [key, val.message])
  );
}

/* -------------------------------------------------------------------------
   GET /api/applications — list with search, filters, sorting, pagination
   ------------------------------------------------------------------------- */
router.get("/", async function (req, res) {
  try {
    const {
      search,
      status,
      workMode,
      employmentType,
      jobSource,
      priority,
      sort,
      page,
      limit,
    } = req.query;

    const filter = { userId: req.user._id };

    if (status) filter.status = status;
    if (workMode) filter.workMode = workMode;
    if (employmentType) filter.employmentType = employmentType;
    if (jobSource) filter.jobSource = jobSource;
    if (priority) filter.priority = priority;

    if (search) {
      const regex = new RegExp(escapeRegex(String(search)), "i");
      filter.$or = [
        { companyName: regex },
        { jobRole: regex },
        { location: regex },
        { recruiterName: regex },
        { tags: { $in: [regex] } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const SORTABLE = {
      createdAt: "createdAt",
      applicationDate: "applicationDate",
      companyName: "companyName",
      jobRole: "jobRole",
      interviewDate: "interviewDate",
      followUpDate: "followUpDate",
      deadline: "deadline",
      priority: "priority",
      status: "status",
      updatedAt: "updatedAt",
    };

    let sortOption = { createdAt: -1 };
    if (sort) {
      const [rawField, dir] = String(sort).split(":");
      const field = SORTABLE[rawField];
      if (field) sortOption = { [field]: dir === "asc" ? 1 : -1 };
    }

    const [applications, total] = await Promise.all([
      Application.find(filter).sort(sortOption).skip(skip).limit(limitNum).lean(),
      Application.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: normalizeDocs(applications),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("GET /api/applications error:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve applications",
    });
  }
});

/* -------------------------------------------------------------------------
   GET /api/applications/:id
   ------------------------------------------------------------------------- */
router.get("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid application ID" });
    }
    const application = await Application.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    res.json({ success: true, data: normalizeDoc(application) });
  } catch (err) {
    console.error("GET /api/applications/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to retrieve application" });
  }
});

/* -------------------------------------------------------------------------
   POST /api/applications — create
   ------------------------------------------------------------------------- */
router.post("/", async function (req, res) {
  try {
    const payload = { ...req.body, userId: req.user._id };
    delete payload.id;
    delete payload._id;
    delete payload.__v;
    // History is server-owned: never accept a client-supplied trail.
    delete payload.statusHistory;

    payload.statusHistory = [
      { from: null, to: payload.status || "Applied", at: new Date() },
    ];

    const application = new Application(payload);
    await application.save();

    res.status(201).json({
      success: true,
      message: "Application created successfully",
      data: normalizeDoc(application.toObject()),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationDetails(err),
      });
    }
    console.error("POST /api/applications error:", err.message);
    res.status(500).json({ success: false, message: "Failed to create application" });
  }
});

/* -------------------------------------------------------------------------
   PUT /api/applications/:id — update (never changes identity or owner)
   ------------------------------------------------------------------------- */
router.put("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid application ID" });
    }

    const payload = { ...req.body };
    delete payload.id;
    delete payload._id;
    delete payload.__v;
    delete payload.userId; // ownership can never be reassigned
    delete payload.createdAt;
    delete payload.updatedAt;
    delete payload.statusHistory; // server-owned; see the $push below

    const existing = await Application.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();

    if (!existing) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const update = { ...payload };
    if (typeof payload.status === "string" && payload.status !== existing.status) {
      // Append one transition and keep the trail bounded.
      update.$push = {
        statusHistory: {
          $each: [{ from: existing.status, to: payload.status, at: new Date() }],
          $slice: -100,
        },
      };
    }

    const application = await Application.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { returnDocument: "after", runValidators: true }
    ).lean();

    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    res.json({
      success: true,
      message: "Application updated successfully",
      data: normalizeDoc(application),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationDetails(err),
      });
    }
    console.error("PUT /api/applications/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update application" });
  }
});

/* -------------------------------------------------------------------------
   DELETE /api/applications — delete every record owned by the current user.
   Destructive, so the client must echo an explicit confirmation token.
   ------------------------------------------------------------------------- */
router.delete("/", async function (req, res) {
  try {
    if (!req.body || req.body.confirm !== "DELETE") {
      return res.status(400).json({
        success: false,
        message:
          'This deletes every application and interview round. Send { "confirm": "DELETE" } to proceed.',
        code: "CONFIRMATION_REQUIRED",
      });
    }

    const [applications, interviews] = await Promise.all([
      Application.deleteMany({ userId: req.user._id }),
      Interview.deleteMany({ userId: req.user._id }),
    ]);

    res.json({
      success: true,
      message: "All application data deleted.",
      deletedApplications: applications.deletedCount || 0,
      deletedInterviews: interviews.deletedCount || 0,
    });
  } catch (err) {
    console.error("DELETE /api/applications error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete application data" });
  }
});

/* -------------------------------------------------------------------------
   DELETE /api/applications/:id — delete (cascades to interview rounds)
   ------------------------------------------------------------------------- */
router.delete("/:id", async function (req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid application ID" });
    }

    const application = await Application.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const removedInterviews = await Interview.deleteMany({
      applicationId: application._id,
      userId: req.user._id,
    });

    res.json({
      success: true,
      message: "Application deleted successfully",
      deletedInterviews: removedInterviews.deletedCount || 0,
    });
  } catch (err) {
    console.error("DELETE /api/applications/:id error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete application" });
  }
});

/** Escape user input before using it inside a RegExp. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = router;
