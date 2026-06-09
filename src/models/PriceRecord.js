import mongoose from 'mongoose';

const PriceRecordSchema = new mongoose.Schema({
  linkId: { type: String, required: true, ref: 'Link', index: true },
  date: { type: String, required: true }, // Format YYYY-MM-DD
  pricePerNight: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Ensure only one price history entry exists per day per listing
PriceRecordSchema.index({ linkId: 1, date: 1 }, { unique: true });

export default mongoose.models.PriceRecord || mongoose.model('PriceRecord', PriceRecordSchema);
