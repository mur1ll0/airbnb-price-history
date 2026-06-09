import mongoose from 'mongoose';

const RoomPriceRecordSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true }, // Airbnb room ID (numeric string)
  date: { type: String, required: true }, // Format YYYY-MM-DD
  pricePerNight: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Ensure only one general price history entry exists per day per room ID
RoomPriceRecordSchema.index({ roomId: 1, date: 1 }, { unique: true });

export default mongoose.models.RoomPriceRecord || mongoose.model('RoomPriceRecord', RoomPriceRecordSchema);
