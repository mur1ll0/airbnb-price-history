import mongoose from 'mongoose';

const UserLinkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  linkId: { type: String, required: true, ref: 'Link', index: true },
  createdAt: { type: Date, default: Date.now }
});

// Ensure a user tracks each listing at most once
UserLinkSchema.index({ userId: 1, linkId: 1 }, { unique: true });

export default mongoose.models.UserLink || mongoose.model('UserLink', UserLinkSchema);
