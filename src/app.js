import express from 'express';
import cors from 'cors';
import path from 'path';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { connectDB } from './db.js';
import User from './models/User.js';
import Link from './models/Link.js';
import PriceRecord from './models/PriceRecord.js';
import UserLink from './models/UserLink.js';
import RoomPriceRecord from './models/RoomPriceRecord.js';
import { parseAirbnbUrl } from './scraper.js';

const app = express();

app.use(cors());
app.use(express.json());

// Serve static frontend files (mostly useful for local testing)
app.use(express.static(path.join(process.cwd(), 'public')));

// Middleware: Authenticate JWT Token
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação ausente. Por favor, faça login novamente.' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'fallback-jwt-secret-key-local', (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Sessão expirada ou inválida. Por favor, faça login novamente.' });
    }
    req.user = decodedUser;
    next();
  });
}

// 0. Public config endpoint for frontend configuration
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// 1. Google OAuth Token Verification & Authentication
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'idToken é obrigatório.' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID não está configurado no servidor.' });
  }

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    // Find or create User
    let user = await User.findOne({ googleId });
    if (!user) {
      user = new User({ googleId, email, name, picture });
      await user.save();
      console.log(`New user created: ${name} (${email})`);
    } else {
      // Update details if profile changed
      user.name = name;
      user.picture = picture;
      user.email = email;
      await user.save();
    }

    // Generate session JWT token (valid for 7 days)
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback-jwt-secret-key-local',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture
      }
    });

  } catch (err) {
    console.error('Error during Google authentication:', err);
    res.status(401).json({ error: 'Token do Google inválido ou expirado.' });
  }
});

// 2. Fetch authenticated profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      picture: user.picture
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil.' });
  }
});

// Helper: Calculate Cost-Benefit Score grouped by Region and Nights
function calculateCostBenefit(listings) {
  const groups = {};
  listings.forEach(listing => {
    const regionKey = (listing.region || 'Desconhecido').toLowerCase().trim();
    const groupKey = `${regionKey}_${listing.nights}_nights`;
    
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(listing);
  });

  const processedListings = [];

  for (const groupKey in groups) {
    const groupListings = groups[groupKey];
    
    const prices = groupListings.map(l => l.pricePerNight).filter(p => p !== null);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

    groupListings.forEach(listing => {
      let priceScore = 50; 
      if (listing.pricePerNight !== null) {
        if (maxPrice === minPrice) {
          priceScore = Math.max(0, Math.min(100, 100 - (listing.pricePerNight / 5)));
        } else {
          priceScore = 30 + (70 * (maxPrice - listing.pricePerNight) / (maxPrice - minPrice));
        }
      }

      const ratingVal = listing.rating !== null ? listing.rating : 4.0;
      const ratingScore = ratingVal * 20;

      const reviewsWeight = Math.min((listing.reviewsCount || 0) * 2, 100);

      const discountScore = Math.min((listing.discountPercent || 0) * 3, 100);

      let finalScore = 0;
      let breakdown = {};
      
      if (listing.pricePerNight !== null && !listing.isUnavailable) {
        finalScore = (priceScore * 0.40) + (ratingScore * 0.30) + (reviewsWeight * 0.15) + (discountScore * 0.15);
        breakdown = {
          priceScore: parseFloat(priceScore.toFixed(1)),
          ratingScore: parseFloat(ratingScore.toFixed(1)),
          reviewsScore: parseFloat(reviewsWeight.toFixed(1)),
          discountScore: parseFloat(discountScore.toFixed(1))
        };
      } else {
        finalScore = 0;
        breakdown = { priceScore: 0, ratingScore: 0, reviewsScore: 0, discountScore: 0 };
      }

      processedListings.push({
        ...listing,
        costBenefitScore: parseFloat(finalScore.toFixed(1)),
        breakdown
      });
    });
  }

  return processedListings.sort((a, b) => b.costBenefitScore - a.costBenefitScore);
}

// 3. Get user's tracked listings (ranked)
app.get('/api/listings/ranked', authenticateToken, async (req, res) => {
  try {
    // 1. Get user mappings
    const userLinks = await UserLink.find({ userId: req.user.id });
    const linkIds = userLinks.map(ul => ul.linkId);

    // 2. Fetch links
    const links = await Link.find({ _id: { $in: linkIds } }).lean();

    // 3. For each link, fetch its price history
    const enrichedLinks = await Promise.all(
      links.map(async (link) => {
        const histories = await PriceRecord.find({ linkId: link._id }).sort({ date: 1 }).lean();
        const generalHistories = await RoomPriceRecord.find({ roomId: link.roomId }).sort({ date: 1 }).lean();
        return {
          id: link._id,
          ...link,
          priceHistory: histories.map(h => ({
            date: h.date,
            pricePerNight: h.pricePerNight,
            totalPrice: h.totalPrice
          })),
          generalPriceHistory: generalHistories.map(h => ({
            date: h.date,
            pricePerNight: h.pricePerNight,
            totalPrice: h.totalPrice
          }))
        };
      })
    );

    // 4. Calculate cost benefit scores
    const ranked = calculateCostBenefit(enrichedLinks);
    res.json(ranked);
  } catch (err) {
    console.error('Error fetching ranked listings:', err);
    res.status(500).json({ error: 'Erro ao carregar hospedagens ranqueadas.' });
  }
});

// 4. Get user's tracked listings (raw list)
app.get('/api/listings', authenticateToken, async (req, res) => {
  try {
    const userLinks = await UserLink.find({ userId: req.user.id });
    const linkIds = userLinks.map(ul => ul.linkId);
    const links = await Link.find({ _id: { $in: linkIds } }).lean();
    res.json(links.map(l => ({ id: l._id, ...l })));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar hospedagens.' });
  }
});

// 5. Add a new listing to user profile (scrapes asynchronously in the background)
app.post('/api/listings', authenticateToken, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'A URL do anúncio é obrigatória.' });
  }

  // Validate Airbnb Room URL format
  const airbnbRoomRegex = /^(https?:\/\/)?(www\.)?airbnb\.[a-z.]+\/rooms\/\d+/i;
  if (!airbnbRoomRegex.test(url)) {
    return res.status(400).json({ 
      error: 'Link inválido! Certifique-se de inserir uma URL de hospedagem individual no padrão: https://www.airbnb.com.br/rooms/ID_DO_ANUNCIO' 
    });
  }

  try {
    const { id: roomId, checkIn, checkOut, location } = parseAirbnbUrl(url);

    // Determine duration
    let nights = 1;
    if (checkIn && checkOut) {
      const start = new Date(checkIn);
      const end = new Date(checkOut);
      const diffTime = Math.abs(end - start);
      nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    }

    const comboId = `${roomId}_${checkIn}_${checkOut}`;

    // Check if the link already exists in MongoDB
    let link = await Link.findById(comboId);
    let isNewLink = false;

    if (!link) {
      isNewLink = true;
      // Save placeholder/pending listing
      link = new Link({
        _id: comboId,
        roomId,
        url,
        title: 'Carregando dados do anúncio...',
        region: location || 'Identificando...',
        checkIn,
        checkOut,
        nights,
        isUnavailable: false
      });
      await link.save();
    }

    // Link this listing to the current user
    try {
      const userLink = new UserLink({
        userId: req.user.id,
        linkId: comboId
      });
      await userLink.save();
    } catch (ulErr) {
      if (ulErr.code === 11000) {
        // User is already tracking this link, ignore unique index collision
      } else {
        throw ulErr;
      }
    }

    // Handle Scraping trigger
    if (isNewLink) {
      if (process.env.GITHUB_PAT && process.env.GITHUB_REPO) {
        // Dispatch GitHub Action scraper
        try {
          const ghResponse = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/dispatches`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.GITHUB_PAT}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              event_type: 'scrape-listing',
              client_payload: { linkId: comboId }
            })
          });
          
          if (!ghResponse.ok) {
            const errText = await ghResponse.text();
            console.error('GitHub API dispatch failed:', errText);
          } else {
            console.log(`Successfully dispatched GitHub Action to scrape room ${comboId}`);
          }
        } catch (ghErr) {
          console.error('Failed to trigger GitHub Action dispatch:', ghErr.message);
        }
      } else {
        // Fallback for Local Dev or when GitHub keys are absent
        console.log('GitHub keys absent, attempting local async scraping...');
        import('./scraper.js').then(async ({ scrapeListing }) => {
          try {
            const scrapedData = await scrapeListing(url);
            
            // Map the parsed properties
            await Link.findByIdAndUpdate(comboId, {
              title: scrapedData.title,
              image: scrapedData.image,
              rating: scrapedData.rating,
              reviewsCount: scrapedData.reviewsCount,
              capacity: scrapedData.capacity,
              region: scrapedData.region || link.region,
              isUnavailable: scrapedData.isUnavailable,
              currentPrice: scrapedData.currentPrice,
              originalPrice: scrapedData.originalPrice,
              pricePerNight: scrapedData.pricePerNight,
              originalPricePerNight: scrapedData.originalPricePerNight,
              discountPercent: scrapedData.discountPercent,
              scrapedAt: new Date()
            });

            if (scrapedData.currentPrice !== null) {
              const todayStr = new Date().toISOString().split('T')[0];
              await PriceRecord.findOneAndUpdate(
                { linkId: comboId, date: todayStr },
                { pricePerNight: scrapedData.pricePerNight, totalPrice: scrapedData.currentPrice },
                { upsert: true }
              );
              await RoomPriceRecord.findOneAndUpdate(
                { roomId, date: todayStr },
                { pricePerNight: scrapedData.pricePerNight, totalPrice: scrapedData.currentPrice },
                { upsert: true }
              );
            }
            console.log(`Local background scraping completed for Room ${comboId}`);
          } catch (scrapeErr) {
            console.error(`Local background scrape failed for Room ${comboId}:`, scrapeErr.message);
            // Update title to let user know it failed
            await Link.findByIdAndUpdate(comboId, { title: 'Falha ao coletar dados (Verifique o Link)' });
          }
        });
      }
    }

    res.status(201).json({
      id: link._id,
      url: link.url,
      title: link.title,
      image: link.image,
      region: link.region,
      checkIn: link.checkIn,
      checkOut: link.checkOut,
      nights: link.nights,
      scrapedAt: link.scrapedAt
    });

  } catch (err) {
    console.error('Error adding listing:', err);
    res.status(500).json({ error: `Erro ao adicionar hospedagem: ${err.message}` });
  }
});

// 6. Untrack/Delete a listing for the user
app.delete('/api/listings/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await UserLink.findOneAndDelete({ userId: req.user.id, linkId: id });
    if (deleted) {
      res.json({ message: 'Hospedagem removida da sua lista com sucesso.' });
    } else {
      res.status(404).json({ error: 'Associação não encontrada.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover hospedagem.' });
  }
});

// 7. Trigger manual update of a specific listing
app.post('/api/listings/scrape/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Verify user tracks this link
    const userLink = await UserLink.findOne({ userId: req.user.id, linkId: id });
    if (!userLink) {
      return res.status(403).json({ error: 'Acesso negado. Você não acompanha esta hospedagem.' });
    }

    const link = await Link.findById(id);
    if (!link) {
      return res.status(404).json({ error: 'Hospedagem não encontrada.' });
    }

    // Check expiration: cannot update expired listings (today > checkOut)
    const todayStr = new Date().toISOString().split('T')[0];
    if (link.checkOut && todayStr > link.checkOut) {
      return res.status(400).json({ error: 'Esta hospedagem está expirada (a data de check-out já passou) e não pode ser atualizada.' });
    }

    // 2. Trigger scraper
    if (process.env.GITHUB_PAT && process.env.GITHUB_REPO) {
      // Dispatch GitHub Action
      try {
        const ghResponse = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            event_type: 'scrape-listing',
            client_payload: { linkId: id }
          })
        });
        
        if (!ghResponse.ok) {
          const errText = await ghResponse.text();
          console.error('GitHub API dispatch failed for manual scrape:', errText);
          return res.status(502).json({ error: 'Falha ao acionar o executor no GitHub.' });
        }
        
        res.json({ message: 'Atualização solicitada em segundo plano. Os dados serão atualizados em breve!' });
      } catch (ghErr) {
        console.error('Failed to trigger GitHub Action dispatch:', ghErr.message);
        res.status(500).json({ error: 'Erro ao solicitar atualização no GitHub.' });
      }
    } else {
      // Local development fallback
      console.log('GitHub credentials missing, scraping locally for manual trigger...');
      import('./scraper.js').then(async ({ scrapeListing }) => {
        try {
          const scrapedData = await scrapeListing(link.url);
          
          await Link.findByIdAndUpdate(id, {
            title: scrapedData.title,
            image: scrapedData.image,
            rating: scrapedData.rating,
            reviewsCount: scrapedData.reviewsCount,
            capacity: scrapedData.capacity,
            region: scrapedData.region || link.region,
            isUnavailable: scrapedData.isUnavailable,
            currentPrice: scrapedData.currentPrice,
            originalPrice: scrapedData.originalPrice,
            pricePerNight: scrapedData.pricePerNight,
            originalPricePerNight: scrapedData.originalPricePerNight,
            discountPercent: scrapedData.discountPercent,
            scrapedAt: new Date()
          });

          if (scrapedData.currentPrice !== null) {
            const todayStr = new Date().toISOString().split('T')[0];
            await PriceRecord.findOneAndUpdate(
              { linkId: id, date: todayStr },
              { pricePerNight: scrapedData.pricePerNight, totalPrice: scrapedData.currentPrice },
              { upsert: true }
            );
            await RoomPriceRecord.findOneAndUpdate(
              { roomId: link.roomId, date: todayStr },
              { pricePerNight: scrapedData.pricePerNight, totalPrice: scrapedData.currentPrice },
              { upsert: true }
            );
          }
          console.log(`Local manual scraping completed for Room ${id}`);
        } catch (scrapeErr) {
          console.error(`Local manual scrape failed for Room ${id}:`, scrapeErr.message);
        }
      });

      res.json({ message: 'Atualização iniciada em segundo plano localmente.' });
    }
  } catch (err) {
    res.status(500).json({ error: `Erro ao atualizar hospedagem: ${err.message}` });
  }
});

// 8. Trigger manual update of ALL user's listings
app.post('/api/listings/scrape', authenticateToken, async (req, res) => {
  try {
    if (process.env.GITHUB_PAT && process.env.GITHUB_REPO) {
      // Dispatch GitHub Action for all listings
      const ghResponse = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_PAT}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'scrape-all',
          client_payload: {}
        })
      });
      
      if (!ghResponse.ok) {
        const errText = await ghResponse.text();
        console.error('GitHub API dispatch failed for global scrape:', errText);
        return res.status(502).json({ error: 'Falha ao acionar a atualização global no GitHub.' });
      }
      
      res.json({ message: 'Sincronização global solicitada! O worker do GitHub Actions atualizará todas as hospedagens em segundo plano.' });
    } else {
      console.log('GitHub credentials missing, running local sync in background...');
      import('./cron-scraper.js').then(({ runCronScrape }) => {
        runCronScrape().catch(err => console.error('Local background global scrape failed:', err));
      });
      res.json({ message: 'Sincronização global iniciada em segundo plano localmente.' });
    }
  } catch (err) {
    res.status(500).json({ error: `Erro ao iniciar sincronização: ${err.message}` });
  }
});

export { app };
