const mongoose = require("mongoose");

// Status values are consistent across forms, tables, filters, and analytics.
const STATUS_ENUM = [
  "Bookmarked",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];

const WORK_MODE_ENUM = ["On-site", "Hybrid", "Remote"];
const EMPLOYMENT_TYPE_ENUM = ["Full-time", "Internship", "Contract", "Part-time"];
const JOB_SOURCE_ENUM = [
  "LinkedIn",
  "Company Website",
  "Referral",
  "Campus Placement",
  "Job Portal",
  "Other",
];
const PRIORITY_ENUM = ["Low", "Medium", "High"];

const applicationSchema = new mongoose.Schema(
  {
    // Owner — every query is scoped by this field.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxlength: 200,
    },
    jobRole: {
      type: String,
      required: [true, "Job role is required"],
      trim: true,
      maxlength: 200,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: "Applied",
    },
    applicationDate: { type: Date },
    jobLink: { type: String, trim: true, maxlength: 500 },
    jobDescription: { type: String, maxlength: 10000 },
    companyWebsite: { type: String, trim: true, maxlength: 500 },
    location: { type: String, trim: true, maxlength: 200 },
    workMode: { type: String, enum: WORK_MODE_ENUM, trim: true },
    employmentType: {
      type: String,
      enum: EMPLOYMENT_TYPE_ENUM,
      trim: true,
    },
    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    currency: { type: String, trim: true, maxlength: 10, default: "USD" },
    recruiterName: { type: String, trim: true, maxlength: 200 },
    recruiterEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    recruiterLinkedIn: { type: String, trim: true, maxlength: 500 },
    jobSource: {
      type: String,
      enum: JOB_SOURCE_ENUM,
      trim: true,
    },
    priority: {
      type: String,
      enum: PRIORITY_ENUM,
      default: "Medium",
    },
    followUpDate: { type: Date },
    interviewDate: { type: Date },
    deadline: { type: Date },
    notes: { type: String, maxlength: 10000 },
    tags: [{ type: String, trim: true, maxlength: 50 }],

    // Append-only trail of status transitions. Written by the server only;
    // clients cannot submit or rewrite it. `at` is a real instant.
    statusHistory: [
      {
        _id: false,
        from: { type: String, default: null },
        to: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Expose a stable `id` property mapped from MongoDB `_id` so the frontend
// can use a single identifier consistently (no mixing of `id` and `_id`).
applicationSchema.virtual("id").get(function () {
  return this._id.toString();
});

applicationSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
  },
});

applicationSchema.set("toObject", {
  virtuals: true,
  versionKey: false,
});

module.exports = mongoose.model("Application", applicationSchema);
module.exports.STATUS_ENUM = STATUS_ENUM;
module.exports.WORK_MODE_ENUM = WORK_MODE_ENUM;
module.exports.EMPLOYMENT_TYPE_ENUM = EMPLOYMENT_TYPE_ENUM;
module.exports.JOB_SOURCE_ENUM = JOB_SOURCE_ENUM;
module.exports.PRIORITY_ENUM = PRIORITY_ENUM;
