const mongoose = require("mongoose");

/**
 * A session is a random 256-bit token stored in an HttpOnly cookie.
 * Only the SHA-256 hash of the token is persisted, so a database leak
 * cannot be replayed as a valid session.
 */
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 60 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
