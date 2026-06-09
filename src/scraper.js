import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

// Extract query parameters from URL
export function parseAirbnbUrl(urlString) {
  try {
    const url = new URL(urlString);
    
    // Extract room ID from pathname, e.g. /rooms/1070588091988976266
    const pathParts = url.pathname.split('/');
    const roomsIndex = pathParts.indexOf('rooms');
    let id = '';
    if (roomsIndex !== -1 && pathParts[roomsIndex + 1]) {
      id = pathParts[roomsIndex + 1];
    } else {
      // Fallback: search for numbers in pathname
      const match = url.pathname.match(/\/(\d+)/);
      id = match ? match[1] : Math.random().toString(36).substring(7);
    }

    const checkIn = url.searchParams.get('check_in') || '';
    const checkOut = url.searchParams.get('check_out') || '';
    const location = url.searchParams.get('location') || '';

    return { id, checkIn, checkOut, location };
  } catch (err) {
    console.error('Error parsing URL:', urlString, err.message);
    return { id: Math.random().toString(36).substring(7), checkIn: '', checkOut: '', location: '' };
  }
}

// Scrape a single Airbnb listing
export async function scrapeListing(url) {
  const { id, checkIn, checkOut, location: urlLocation } = parseAirbnbUrl(url);
  
  console.log(`Starting scrape for Room ID ${id}...`);
  console.log(`URL: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Go to URL and wait for network to be idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // Additional wait for client-side React hydration of booking card/pricing
    await new Promise(resolve => setTimeout(resolve, 5000));

    const html = await page.content();
    const $ = cheerio.load(html);

    // 1. Metadata extraction from JSON-LD SEO Schema
    let title = $('title').text().split('-')[0].trim();
    let region = urlLocation || '';
    let rating = null;
    let reviewsCount = 0;
    let image = '';
    let capacity = '';

    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        
        // Target VacationRental or Product schemas
        const isRental = data['@type'] === 'VacationRental' || data['@type'] === 'Product' || 
                         (Array.isArray(data['@type']) && data['@type'].includes('VacationRental'));
        
        if (isRental) {
          if (data.name) title = data.name;
          if (data.address && data.address.addressLocality) {
            region = data.address.addressLocality;
          }
          if (data.image && data.image.length > 0) {
            image = data.image[0];
          }
          if (data.aggregateRating) {
            if (data.aggregateRating.ratingValue) rating = parseFloat(data.aggregateRating.ratingValue);
            if (data.aggregateRating.ratingCount) reviewsCount = parseInt(data.aggregateRating.ratingCount, 10);
          }
        }
      } catch (err) {
        // Skip invalid JSON-LD
      }
    });

    // Fallbacks if Schema extraction is incomplete
    if (!region) {
      // Try to parse from Title (e.g. "... em Teresina, Piauí, Brasil")
      const titleText = $('title').text();
      const emIndex = titleText.indexOf(' em ');
      if (emIndex !== -1) {
        const afterEm = titleText.substring(emIndex + 4);
        region = afterEm.split(',')[0].trim();
      } else {
        region = 'Desconhecido';
      }
    }

    // Extract capacity details from DOM if possible
    // Usually look for elements containing guests and rooms
    $('*').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('hóspede') && text.includes('quarto') && text.length < 100) {
        capacity = text.replace(/\s+/g, ' ');
      }
    });

    // 2. Nights calculation
    let nights = 1;
    if (checkIn && checkOut) {
      const start = new Date(checkIn);
      const end = new Date(checkOut);
      const diffTime = Math.abs(end - start);
      nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    }

    // 3. Price parsing from DOM text
    // Normalize body text
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    
    let currentPrice = null;
    let originalPrice = null;
    let pricePerNight = null;

    // Search for "Total" or similar pricing label
    const totalIndex = bodyText.indexOf('Total:');
    let prices = [];

    if (totalIndex !== -1) {
      const snippet = bodyText.substring(totalIndex, totalIndex + 150);
      // Regex looking for R$ followed by space/nbsp and digits with dots/commas
      const priceRegex = /R\$[\s\u00a0]*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/g;
      let m;
      while ((m = priceRegex.exec(snippet)) !== null) {
        const clean = m[1].replace(/\./g, '').replace(/,/g, '.');
        prices.push(parseFloat(clean));
      }
    }

    // If we didn't find any prices near "Total", fall back to scanning the entire body for prices
    if (prices.length === 0) {
      const priceRegex = /R\$[\s\u00a0]*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/g;
      let m;
      const allPrices = [];
      while ((m = priceRegex.exec(bodyText)) !== null) {
        const clean = m[1].replace(/\./g, '').replace(/,/g, '.');
        allPrices.push(parseFloat(clean));
      }
      
      // Filter out small installment prices (like "6x R$ 232") by looking for larger numbers,
      // or take the most frequent ones. Usually the total price is the largest number.
      if (allPrices.length > 0) {
        const unique = Array.from(new Set(allPrices)).sort((a, b) => b - a);
        // Take the top 1 or 2 prices
        prices = unique.slice(0, 2);
      }
    }

    if (prices.length > 0) {
      if (prices.length >= 2) {
        // If two prices are found (e.g. original and discounted), the smaller is current, the larger is original
        originalPrice = Math.max(prices[0], prices[1]);
        currentPrice = Math.min(prices[0], prices[1]);
      } else {
        currentPrice = prices[0];
        originalPrice = prices[0];
      }
      
      pricePerNight = parseFloat((currentPrice / nights).toFixed(2));
    } else {
      console.warn(`Warning: Could not parse price for room ${id}. Setting to null.`);
    }

    // Check if dates are unavailable on the page
    const lowerBody = bodyText.toLowerCase();
    const isUnavailable = lowerBody.includes('essas datas não estão disponíveis') || 
                          lowerBody.includes('datas não estão disponíveis') ||
                          lowerBody.includes('datas indisponíveis') ||
                          lowerBody.includes('indisponível') ||
                          lowerBody.includes('indisponíveis');

    const discountPercent = originalPrice && currentPrice && originalPrice > currentPrice
      ? parseFloat((((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2))
      : 0;

    return {
      id,
      url,
      title,
      image,
      rating,
      reviewsCount,
      capacity,
      region,
      checkIn,
      checkOut,
      nights,
      isUnavailable,
      currentPrice,
      originalPrice,
      pricePerNight,
      originalPricePerNight: originalPrice ? parseFloat((originalPrice / nights).toFixed(2)) : null,
      discountPercent,
      scrapedAt: new Date().toISOString()
    };

  } catch (err) {
    console.error(`Error scraping listing ${url}:`, err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
