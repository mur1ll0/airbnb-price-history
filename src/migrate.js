import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import Link from './models/Link.js';
import UserLink from './models/UserLink.js';
import PriceRecord from './models/PriceRecord.js';
import RoomPriceRecord from './models/RoomPriceRecord.js';

// Load environment variables
dotenv.config();

async function migrate() {
  console.log('[migration] Starting database migration...');
  await connectDB();

  // Drop legacy unique index on url if it exists
  try {
    await Link.collection.dropIndex('url_1');
    console.log('[migration] Successfully dropped legacy unique index url_1 from links collection.');
  } catch (err) {
    console.log('[migration] Note: legacy index url_1 was not found or already dropped.');
  }

  // 1. Migrate Links, UserLinks, and PriceRecords to composite IDs
  const allLinks = await Link.find({});
  console.log(`[migration] Found ${allLinks.length} total links in database.`);

  for (const oldLink of allLinks) {
    const isOldId = !oldLink._id.includes('_');
    if (isOldId) {
      const roomId = oldLink._id;
      const checkIn = oldLink.checkIn || '';
      const checkOut = oldLink.checkOut || '';
      const comboId = `${roomId}_${checkIn}_${checkOut}`;

      console.log(`[migration] Migrating Room ${roomId} to composite ${comboId}...`);

      // Check if new link already exists
      let newLink = await Link.findById(comboId);
      if (!newLink) {
        // Create new Link copy
        const linkData = oldLink.toObject();
        delete linkData._id;
        newLink = new Link({
          _id: comboId,
          roomId,
          ...linkData
        });
        await newLink.save();
        console.log(`[migration] Created new Link document for ${comboId}`);
      }

      // Update UserLinks that reference the old linkId
      const userLinkUpdate = await UserLink.updateMany(
        { linkId: roomId },
        { linkId: comboId }
      );
      console.log(`[migration] Updated ${userLinkUpdate.modifiedCount} UserLink associations.`);

      // Update PriceRecords that reference the old linkId
      const priceRecordUpdate = await PriceRecord.updateMany(
        { linkId: roomId },
        { linkId: comboId }
      );
      console.log(`[migration] Updated ${priceRecordUpdate.modifiedCount} PriceRecord histories.`);

      // Delete old Link document
      await Link.deleteOne({ _id: roomId });
      console.log(`[migration] Deleted old legacy Link document for ${roomId}`);
    } else {
      // It is already a comboId, make sure the roomId field is set
      if (!oldLink.roomId) {
        const roomId = oldLink._id.split('_')[0];
        oldLink.roomId = roomId;
        await oldLink.save();
        console.log(`[migration] Updated missing roomId field for ${oldLink._id}`);
      }
    }
  }

  // 2. Populate RoomPriceRecord using all PriceRecords
  const allPriceRecords = await PriceRecord.find({});
  console.log(`[migration] Found ${allPriceRecords.length} price records to populate RoomPriceRecord.`);

  let createdRoomRecords = 0;
  for (const pr of allPriceRecords) {
    const roomId = pr.linkId.split('_')[0];
    
    // Upsert into RoomPriceRecord
    const result = await RoomPriceRecord.findOneAndUpdate(
      { roomId, date: pr.date },
      {
        pricePerNight: pr.pricePerNight,
        totalPrice: pr.totalPrice,
        createdAt: pr.createdAt
      },
      { upsert: true, new: true }
    );
    if (result) {
      createdRoomRecords++;
    }
  }
  console.log(`[migration] Successfully populated/updated ${createdRoomRecords} RoomPriceRecord general entries.`);

  console.log('[migration] Database migration completed successfully.');
}

migrate()
  .then(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('[migration] Database connection closed.');
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migration] Migration failed:', err);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
