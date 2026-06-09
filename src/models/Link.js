import mongoose from 'mongoose';

const LinkSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Airbnb room ID with dates: roomId_checkIn_checkOut
  roomId: { type: String, required: true, index: true }, // Airbnb room ID (numeric string)
  url: { type: String, required: true },
  title: { type: String, default: 'Carregando...' },
  image: { type: String, default: '' },
  rating: { type: Number, default: null },
  reviewsCount: { type: Number, default: 0 },
  capacity: { type: String, default: '' },
  region: { type: String, default: '' },
  checkIn: { type: String, default: '' },
  checkOut: { type: String, default: '' },
  nights: { type: Number, default: 1 },
  isUnavailable: { type: Boolean, default: false },
  currentPrice: { type: Number, default: null },
  originalPrice: { type: Number, default: null },
  pricePerNight: { type: Number, default: null },
  originalPricePerNight: { type: Number, default: null },
  discountPercent: { type: Number, default: 0 },
  scrapedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Link || mongoose.model('Link', LinkSchema);
