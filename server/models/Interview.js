const mongoose = require("mongoose");

// Interview types supported by the preparation workspace
const INTERVIEW_TYPE_ENUM = [
  "Recruiter Screen",
  "Technical Interview",
  "Coding Round",
  "System Design",
  "Behavioral Interview",
  "HR Round",
  "Final Interview",
];

const OUTCOME_ENUM = [
  "Pending",
  "Passed",
  "Failed",
  "Rescheduled",
  "Withdrawn",
];

const interviewSchema = new mongoose.Schema(
  {
    // Owner — every query is scoped by this field.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    // Link to the parent application (required for ownership and grouping)
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: [true, "Application ID is required"],
      index: true,
    },
    round: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "Round 1",
    },
    interviewType: {
      type: String,
      enum: INTERVIEW_TYPE_ENUM,
      required: [true, "Interview type is required"],
    },
    interviewDate: {
      type: Date,
      required: [true, "Interview date is required"],
    },
    interviewerName: { type: String, trim: true, maxlength: 200 },
    interviewerEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    location: { type: String, trim: true, maxlength: 200 },
    // Preparation materials
    topicsToPrepare: [{ type: String, trim: true, maxlength: 200 }],
    questionsToAsk: [{ type: String, trim: true, maxlength: 500 }],
    personalNotes: { type: String, maxlength: 10000 },
    preparationChecklist: [
      {
        text: { type: String, trim: true, maxlength: 500, required: true },
        done: { type: Boolean, default: false },
      },
    ],
    outcome: {
      type: String,
      enum: OUTCOME_ENUM,
      default: "Pending",
    },
    nextSteps: { type: String, maxlength: 5000 },
  },
  { timestamps: true }
);

// Expose a stable `id` property mapped from MongoDB `_id`
interviewSchema.virtual("id").get(function () {
  return this._id.toString();
});

interviewSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
  },
});

interviewSchema.set("toObject", {
  virtuals: true,
  versionKey: false,
});

module.exports = mongoose.model("Interview", interviewSchema);
module.exports.INTERVIEW_TYPE_ENUM = INTERVIEW_TYPE_ENUM;
module.exports.OUTCOME_ENUM = OUTCOME_ENUM;
