import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Link from './models/Link.js';
import PriceRecord from './models/PriceRecord.js';
import UserLink from './models/UserLink.js';
import RoomPriceRecord from './models/RoomPriceRecord.js';
import { scrapeListing } from './scraper.js';

// Load environment variables for standalone execution
dotenv.config();

/**
 * Main cron scrape process.
 * Queries all active non-expired listings, scrapes their prices, and updates the database.
 */
export async function runCronScrape() {
  console.log('[cron-scraper] Starting scrape job...');
  
  // Establish connection to database
  await connectDB();

  const todayStr = new Date().toISOString().split('T')[0];
  
  // Check if a specific listing ID was passed as an argument
  const specificLinkId = process.argv[2];
  let activeLinks;

  if (specificLinkId) {
    console.log(`[cron-scraper] Standalone mode: Scraping ONLY Room ID ${specificLinkId}`);
    activeLinks = await Link.find({ _id: specificLinkId });
    if (activeLinks.length === 0) {
      console.warn(`[cron-scraper] Room ID ${specificLinkId} not found in database! Creating initial skeleton...`);
      // Retrieve the link details from the database by ID or if not present, fetch from argv[3]
      const fallbackUrl = process.argv[3];
      if (fallbackUrl) {
        const roomId = specificLinkId.split('_')[0];
        activeLinks = [new Link({ _id: specificLinkId, roomId, url: fallbackUrl })];
      }
    }
  } else {
    // 1. Get all linkIds that are currently tracked by users
    const trackedUserLinks = await UserLink.find({}).lean();
    const trackedLinkIds = Array.from(new Set(trackedUserLinks.map(ul => ul.linkId)));

    // 2. Fetch active listings: check-out date is today or in the future, OR empty/null, and tracked
    activeLinks = await Link.find({
      _id: { $in: trackedLinkIds },
      $or: [
        { checkOut: { $gte: todayStr } },
        { checkOut: '' },
        { checkOut: null }
      ]
    });
  }

  console.log(`[cron-scraper] Found ${activeLinks.length} active listings to scrape.`);

  const results = [];
  const errors = [];

  for (const link of activeLinks) {
    try {
      console.log(`[cron-scraper] Scraping Room ID ${link._id} (${link.title || link.url})`);
      
      const scrapedData = await scrapeListing(link.url);
      
      // Update link details in MongoDB
      link.title = scrapedData.title;
      link.image = scrapedData.image;
      link.rating = scrapedData.rating;
      link.reviewsCount = scrapedData.reviewsCount;
      link.capacity = scrapedData.capacity;
      link.region = scrapedData.region || link.region;
      link.isUnavailable = scrapedData.isUnavailable;
      link.currentPrice = scrapedData.currentPrice;
      link.originalPrice = scrapedData.originalPrice;
      link.pricePerNight = scrapedData.pricePerNight;
      link.originalPricePerNight = scrapedData.originalPricePerNight;
      link.discountPercent = scrapedData.discountPercent;
      link.scrapedAt = new Date();
      await link.save();

      // Log today's price record in history if price is found
      if (scrapedData.currentPrice !== null) {
        await PriceRecord.findOneAndUpdate(
          { linkId: link._id, date: todayStr },
          {
            pricePerNight: scrapedData.pricePerNight,
            totalPrice: scrapedData.currentPrice
          },
          { upsert: true }
        );
        await RoomPriceRecord.findOneAndUpdate(
          { roomId: link.roomId, date: todayStr },
          {
            pricePerNight: scrapedData.pricePerNight,
            totalPrice: scrapedData.currentPrice
          },
          { upsert: true }
        );
        console.log(`[cron-scraper] Price updated for Room ${link._id}: R$ ${scrapedData.currentPrice}`);
      } else {
        console.log(`[cron-scraper] Price for Room ${link._id} is null (unavailable or couldn't parse).`);
      }

      results.push({ id: link._id, status: 'success' });

      // Respectful delay between listings to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.error(`[cron-scraper] Error scraping Room ID ${link._id}:`, err.message);
      errors.push({ id: link._id, error: err.message });
      
      // Update link title to indicate a failure if it has never been scraped
      if (link.title === 'Carregando dados do anúncio...') {
        link.title = 'Falha ao coletar dados (Verifique o Link)';
        await link.save();
      }
    }
  }

  console.log(`[cron-scraper] Job finished. Successes: ${results.length}, Failures: ${errors.length}`);
  return { success: true, results, errors };
}

// Self-execute if run directly from the command line (e.g. node src/cron-scraper.js)
const isMain = process.argv[1] && (process.argv[1].endsWith('cron-scraper.js') || process.argv[1].endsWith('cron-scraper'));
if (isMain) {
  runCronScrape()
    .then(async () => {
      console.log('[cron-scraper] Execution finished successfully.');
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('[cron-scraper] Database connection closed.');
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[cron-scraper] Critical execution failure:', err);
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      process.exit(1);
    });
}
