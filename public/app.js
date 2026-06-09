// Airbnb Price Tracker Frontend Application

// Check JWT session token on load
const jwtToken = localStorage.getItem('jwt_token');
if (!jwtToken && !window.location.pathname.endsWith('/login.html')) {
  window.location.href = '/login.html';
}

let chartInstance = null;
let currentListings = [];
let pollingTimeout = null;

// Authenticated Fetch Wrapper
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }
  
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };
  
  const response = await fetch(url, options);
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_profile');
    window.location.href = '/login.html';
    throw new Error('Sessão expirada. Por favor, faça login novamente.');
  }
  return response;
}

// DOM Elements
const addForm = document.getElementById('add-listing-form');
const urlInput = document.getElementById('listing-url');
const btnSubmit = document.getElementById('btn-submit');
const btnSync = document.getElementById('btn-sync-all');
const syncIcon = document.getElementById('sync-icon');
const syncText = document.getElementById('sync-text');
const formError = document.getElementById('form-error');
const formSuccess = document.getElementById('form-success');
const groupedContainer = document.getElementById('listings-grouped-container');

// Stats Elements
const statTotalListings = document.getElementById('stat-total-listings');
const statBestDeal = document.getElementById('stat-best-deal');
const statAvgDiscount = document.getElementById('stat-avg-discount');

// Modal Elements
const detailsModal = document.getElementById('details-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modalTitle = document.getElementById('modal-title');
const modalImage = document.getElementById('modal-image');
const modalRegion = document.getElementById('modal-region');
const modalCapacity = document.getElementById('modal-capacity');
const modalRatingRow = document.getElementById('modal-rating-row');
const modalScoreValue = document.getElementById('modal-score-value');
const modalScoreBreakdown = document.getElementById('modal-score-breakdown');
const modalHistoryTbody = document.getElementById('modal-history-tbody');
const modalAirbnbLink = document.getElementById('modal-airbnb-link');

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize User Profile Widget
  const userProfileStr = localStorage.getItem('user_profile');
  if (userProfileStr) {
    const user = JSON.parse(userProfileStr);
    document.getElementById('user-avatar').src = user.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    document.getElementById('user-name').textContent = user.name;
  }
  
  // Set up Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_profile');
    window.location.href = '/login.html';
  });

  fetchAndRenderListings();
  
  // Event Listeners
  addForm.addEventListener('submit', handleAddListing);
  btnSync.addEventListener('click', handleSyncAll);
  closeModalBtn.addEventListener('click', hideModal);
  
  // Close modal when clicking outside contents
  detailsModal.addEventListener('click', (e) => {
    if (e.target === detailsModal) {
      hideModal();
    }
  });
});

// Fetch and render all listings
async function fetchAndRenderListings() {
  showLoading();
  try {
    const response = await apiFetch('/api/listings/ranked');
    if (!response.ok) throw new Error('Falha ao buscar dados das hospedagens.');
    const listings = await response.json();
    currentListings = listings;
    
    updateStats(listings);
    renderListingsGrouped(listings);
    
    // Check if we need to poll for updates (e.g. pending crawls)
    checkPendingCrawls();
  } catch (err) {
    console.error(err);
    renderErrorState(err.message);
  }
}

// Background silent refresh for listings (to update loading states smoothly)
async function fetchAndRenderListingsSilent() {
  try {
    const response = await apiFetch('/api/listings/ranked');
    if (!response.ok) throw new Error('Falha ao buscar hospedagens.');
    const listings = await response.json();
    currentListings = listings;
    
    updateStats(listings);
    renderListingsGrouped(listings);
  } catch (err) {
    console.error('Silent refresh failed:', err);
  }
}

// Monitor listings with placeholder/pending titles and poll for updates
function checkPendingCrawls() {
  if (pollingTimeout) clearTimeout(pollingTimeout);
  
  const hasPending = currentListings.some(l => 
    !l.scrapedAt || 
    l.title === 'Carregando dados do anúncio...' || 
    l.title.includes('Identificando...')
  );
  
  if (hasPending) {
    console.log('Pending crawl detected. Scheduling poll in 5 seconds...');
    pollingTimeout = setTimeout(async () => {
      await fetchAndRenderListingsSilent();
      checkPendingCrawls();
    }, 5000);
  }
}

// Group listings by Region & Stay Duration and render
function renderListingsGrouped(listings) {
  if (listings.length === 0) {
    renderEmptyState();
    return;
  }

  // Group listings
  const groups = {};
  listings.forEach(listing => {
    const regionName = listing.region || 'Desconhecido';
    
    // Create a readable dates summary
    let datesSummary = '';
    if (listing.checkIn && listing.checkOut) {
      const checkInFormatted = formatDateString(listing.checkIn);
      const checkOutFormatted = formatDateString(listing.checkOut);
      datesSummary = ` (${checkInFormatted} a ${checkOutFormatted})`;
    }
    
    const durationLabel = `${listing.nights} ${listing.nights === 1 ? 'noite' : 'noites'}${datesSummary}`;
    const groupKey = `${regionName} - ${durationLabel}`;
    
    if (!groups[groupKey]) {
      groups[groupKey] = {
        region: regionName,
        duration: durationLabel,
        items: []
      };
    }
    groups[groupKey].items.push(listing);
  });

  // Render grouped tables/lists
  let html = '';
  
  for (const groupKey in groups) {
    const group = groups[groupKey];
    
    html += `
      <div class="group-section">
        <div class="group-header">
          <div class="group-title-wrapper">
            <svg class="group-tag-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span class="group-title">${group.region}</span>
          </div>
          <div class="group-meta">
            <span>${group.duration}</span>
            <span class="group-count-badge">${group.items.length} ${group.items.length === 1 ? 'opção' : 'opções'}</span>
          </div>
        </div>
        
        <div class="listings-grid">
          ${group.items.map(listing => renderListingCard(listing)).join('')}
        </div>
      </div>
    `;
  }
  
  groupedContainer.innerHTML = html;
  
  // Attach card event listeners
  attachCardEvents();
}

// Generate single listing card HTML
function renderListingCard(listing) {
  // Score class selection
  let scoreClass = 'score-low';
  if (listing.costBenefitScore >= 75) {
    scoreClass = 'score-high';
  } else if (listing.costBenefitScore >= 50) {
    scoreClass = 'score-med';
  }

  // Rating representation
  const ratingHtml = listing.rating 
    ? `<span>★ ${listing.rating.toFixed(2)}</span> <span class="reviews-count">(${listing.reviewsCount} avaliações)</span>`
    : '<span class="reviews-count">Sem avaliações</span>';

  // Format pricing
  let priceColorClass = '';
  let formattedNightPrice = '';
  if (listing.pricePerNight !== null && listing.pricePerNight !== undefined) {
    formattedNightPrice = `R$ ${formatNumber(listing.pricePerNight)}`;
  } else if (listing.isUnavailable) {
    formattedNightPrice = 'Datas Indisponíveis';
    priceColorClass = 'price-unavailable';
  } else {
    formattedNightPrice = 'Sob consulta';
  }
    
  const formattedTotalPrice = listing.currentPrice 
    ? `R$ ${formatNumber(listing.currentPrice)} total` 
    : '';

  const discountHtml = listing.discountPercent > 0
    ? `<span class="original-price">R$ ${formatNumber(listing.originalPrice / listing.nights)}</span>
       <span class="discount-badge">-${listing.discountPercent}%</span>`
    : '';

  const thumbnail = listing.image || 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=200&q=80';

  const isPending = !listing.scrapedAt || listing.title === 'Carregando dados do anúncio...';

  return `
    <div class="listing-card ${isPending ? 'pending-card' : ''}" data-id="${listing.id}">
      <div class="listing-thumbnail">
        <img src="${thumbnail}" alt="${listing.title}" loading="lazy">
        ${isPending ? '<div class="thumbnail-loader"><span class="spinner"></span></div>' : ''}
      </div>
      
      <div class="listing-info">
        <h3 class="listing-name" title="${listing.title}">${listing.title}</h3>
        <div class="listing-location-dates">
          <span>${listing.region}</span>
          <span>•</span>
          <span>${listing.nights} ${listing.nights === 1 ? 'noite' : 'noites'}</span>
        </div>
        <div class="listing-capacity">${listing.capacity || 'Carregando detalhes...'}</div>
        <div class="listing-rating-row">
          ${ratingHtml}
        </div>
      </div>

      <div class="listing-financials">
        <div class="price-box">
          <span class="nightly-label">Valor por noite</span>
          <div class="price-value-row">
            ${discountHtml}
            <span class="current-price ${priceColorClass}">${formattedNightPrice}</span>
          </div>
          <span class="total-stay-price">${formattedTotalPrice}</span>
        </div>
        
        <div class="score-badge-wrapper">
          <span class="score-lbl">Custo-Benefício</span>
          <div class="score-badge ${scoreClass}">${listing.costBenefitScore}%</div>
        </div>
        
        <div class="action-btn-wrapper">
          <button class="delete-card-btn" data-id="${listing.id}" title="Remover dos favoritos">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Attach click listeners to cards and delete buttons
function attachCardEvents() {
  document.querySelectorAll('.listing-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Prevent modal opening when clicking delete button
      if (e.target.closest('.delete-card-btn')) return;
      
      const id = card.getAttribute('data-id');
      const listing = currentListings.find(l => l.id === id);
      if (listing) showModal(listing);
    });
  });

  document.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const listing = currentListings.find(l => l.id === id);
      if (confirm(`Deseja remover "${listing.title || 'esta hospedagem'}" da sua lista?`)) {
        await handleDeleteListing(id);
      }
    });
  });
}

// Handle Add Listing Form Submit
async function handleAddListing(e) {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  hideMessages();
  setSubmitLoading(true);

  try {
    const response = await apiFetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Falha ao vincular link do Airbnb.');
    }

    showSuccess('Link vinculado! Os dados estão sendo coletados em segundo plano.');
    urlInput.value = '';
    
    // Fetch and check pending crawls
    await fetchAndRenderListingsSilent();
    checkPendingCrawls();
  } catch (err) {
    showError(err.message);
  } finally {
    setSubmitLoading(false);
  }
}

// Handle Global Manual Sync Trigger (via GitHub Action dispatches)
async function handleSyncAll() {
  hideMessages();
  setSyncLoading(true);
  
  try {
    const response = await apiFetch('/api/listings/scrape', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha ao sincronizar preços.');
    
    alert(data.message || 'Sincronização global solicitada! Os links estão sendo atualizados no background.');
    
    // Poll for updates
    await fetchAndRenderListingsSilent();
    checkPendingCrawls();
  } catch (err) {
    alert(`Erro na sincronização: ${err.message}`);
  } finally {
    setSyncLoading(false);
  }
}

// Handle Delete Listing
async function handleDeleteListing(id) {
  try {
    const response = await apiFetch(`/api/listings/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Falha ao remover hospedagem.');
    
    await fetchAndRenderListingsSilent();
  } catch (err) {
    alert(err.message);
  }
}

// Update Header stats cards
function updateStats(listings) {
  statTotalListings.textContent = listings.length;
  
  // Calculate average discount
  const discounted = listings.filter(l => l.discountPercent > 0);
  if (discounted.length > 0) {
    const totalDiscount = discounted.reduce((sum, l) => sum + l.discountPercent, 0);
    statAvgDiscount.textContent = `${(totalDiscount / listings.length).toFixed(0)}%`;
  } else {
    statAvgDiscount.textContent = '0%';
  }

  // Find best deal (highest cost benefit score, excluding loading states)
  const nonPending = listings.filter(l => l.title !== 'Carregando dados do anúncio...' && !l.isUnavailable);
  if (nonPending.length > 0) {
    const best = nonPending[0]; // listings are returned pre-sorted by score
    statBestDeal.textContent = best.title;
    statBestDeal.title = best.title;
  } else {
    statBestDeal.textContent = '-';
    statBestDeal.title = '';
  }
}

// Show/Hide Modal View
function showModal(listing) {
  modalTitle.textContent = listing.title;
  modalImage.src = listing.image || 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=400&q=80';
  modalRegion.textContent = listing.region;
  modalCapacity.textContent = listing.capacity || 'Hóspedes: N/A';
  modalAirbnbLink.href = listing.url;
  
  // Rating Representation
  modalRatingRow.innerHTML = listing.rating 
    ? `<span>★ ${listing.rating.toFixed(2)}</span> <span class="reviews-count">(${listing.reviewsCount} avaliações)</span>`
    : '<span class="reviews-count">Sem avaliações</span>';
    
  modalScoreValue.textContent = `${listing.costBenefitScore}%`;
  
  // Apply score class to modal score value
  modalScoreValue.className = 'score-value';
  if (listing.costBenefitScore >= 75) {
    modalScoreValue.classList.add('accent-emerald');
  } else if (listing.costBenefitScore >= 50) {
    modalScoreValue.classList.add('accent-amber');
  } else {
    modalScoreValue.style.color = '#f87171'; // red
  }

  // Render score breakdown progress gauges
  const bk = listing.breakdown || { priceScore: 0, ratingScore: 0, reviewsScore: 0, discountScore: 0 };
  modalScoreBreakdown.innerHTML = `
    ${renderBreakdownGauge('Preço Relativo', bk.priceScore, 'var(--grad-purple)')}
    ${renderBreakdownGauge('Nota do Anúncio', bk.ratingScore, 'var(--grad-rose)')}
    ${renderBreakdownGauge('Volume de Avaliações', bk.reviewsScore, 'var(--grad-orange)')}
    ${renderBreakdownGauge('Descontos / Promoções', bk.discountScore, 'var(--grad-green)')}
  `;

  // Render price history table
  const history = listing.priceHistory || [];
  if (history.length === 0) {
    modalHistoryTbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; color: var(--text-tertiary);">Nenhum histórico disponível ainda.</td>
      </tr>
    `;
  } else {
    // Show newest records first
    const sortedHistory = [...history].sort((a, b) => b.date.localeCompare(a.date));
    modalHistoryTbody.innerHTML = sortedHistory.map(h => `
      <tr>
        <td>${formatDateString(h.date)}</td>
        <td>R$ ${formatNumber(h.pricePerNight)}</td>
        <td>R$ ${formatNumber(h.totalPrice)}</td>
      </tr>
    `).join('');
  }

  // Draw history chart
  drawChart(history, listing.nights);

  // Configure single listing manual update button
  const modalBtnUpdate = document.getElementById('modal-btn-update');
  const modalUpdateIcon = document.getElementById('modal-update-icon');
  const modalUpdateText = document.getElementById('modal-update-text');

  // Check checkOut date: disable if expired
  const todayStr = new Date().toISOString().split('T')[0];
  const isExpired = listing.checkOut && todayStr > listing.checkOut;

  // Reset state of update button
  modalBtnUpdate.disabled = isExpired;
  modalUpdateIcon.classList.remove('active');
  modalUpdateText.textContent = isExpired ? 'Hospedagem Expirada' : 'Atualizar Preço Agora';

  // Replace button to remove old listeners cleanly
  const newBtnUpdate = modalBtnUpdate.cloneNode(true);
  modalBtnUpdate.parentNode.replaceChild(newBtnUpdate, modalBtnUpdate);

  if (!isExpired) {
    newBtnUpdate.addEventListener('click', async () => {
      newBtnUpdate.disabled = true;
      modalUpdateIcon.classList.add('active');
      modalUpdateText.textContent = 'Solicitando...';
      
      try {
        const response = await apiFetch(`/api/listings/scrape/${listing.id}`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha ao sincronizar preços.');
        
        alert(data.message || 'Atualização solicitada! O worker do GitHub Actions atualizará o preço em instantes.');
        
        // Hide modal and trigger check
        hideModal();
        await fetchAndRenderListingsSilent();
        checkPendingCrawls();
      } catch (err) {
        alert(`Erro: ${err.message}`);
        newBtnUpdate.disabled = false;
        modalUpdateIcon.classList.remove('active');
        modalUpdateText.textContent = 'Atualizar Preço Agora';
      }
    });
  }

  // Show modal
  detailsModal.classList.remove('hidden');
}

function hideModal() {
  detailsModal.classList.add('hidden');
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

// Generate HTML for a score breakdown gauge
function renderBreakdownGauge(label, value, gradient) {
  return `
    <div class="breakdown-row">
      <div class="breakdown-label-row">
        <span>${label}</span>
        <span>${value}%</span>
      </div>
      <div class="breakdown-gauge-bg">
        <div class="breakdown-gauge-fill" style="width: ${value}%; background: ${gradient};"></div>
      </div>
    </div>
  `;
}

// Render Chart using Chart.js
function drawChart(history, nights) {
  const ctx = document.getElementById('priceHistoryChart').getContext('2d');
  
  if (chartInstance) {
    chartInstance.destroy();
  }

  if (history.length === 0) return;

  // Sort history chronologically for the chart
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  
  const labels = sorted.map(h => formatDateString(h.date));
  const dataNightly = sorted.map(h => h.pricePerNight);
  const dataTotal = sorted.map(h => h.totalPrice);

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Preço/Noite (R$)',
          data: dataNightly,
          borderColor: '#ff385c',
          backgroundColor: 'rgba(255, 56, 92, 0.05)',
          borderWidth: 3,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#9ca3af',
            font: { family: 'Outfit', size: 12 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const index = context.dataIndex;
              const tot = dataTotal[index];
              return `Diária: R$ ${formatNumber(val)} | Total: R$ ${formatNumber(tot)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#9ca3af', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { 
            color: '#9ca3af', 
            font: { family: 'Inter', size: 10 },
            callback: function(value) { return 'R$ ' + value; }
          }
        }
      }
    }
  });
}

// Helpers
function showLoading() {
  groupedContainer.innerHTML = `
    <div class="loading-state">
      <span class="spinner"></span>
      <p>Carregando hospedagens...</p>
    </div>
  `;
}

function renderEmptyState() {
  groupedContainer.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <h3>Nenhuma hospedagem vinculada</h3>
      <p>Cole um link do Airbnb acima para iniciar a análise e acompanhar o histórico de preços.</p>
    </div>
  `;
}

function renderErrorState(msg) {
  groupedContainer.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #ef4444;">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h3 style="color: #f87171;">Erro de carregamento</h3>
      <p>${msg}</p>
    </div>
  `;
}

function setSubmitLoading(isLoading) {
  if (isLoading) {
    btnSubmit.disabled = true;
    btnSubmit.querySelector('.btn-text').classList.add('hidden');
    btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');
  } else {
    btnSubmit.disabled = false;
    btnSubmit.querySelector('.btn-text').classList.remove('hidden');
    btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
  }
}

// Handles state of the sync icon in header
function setSyncLoading(isLoading) {
  if (isLoading) {
    btnSync.disabled = true;
    syncIcon.classList.add('active');
    syncText.textContent = 'Sincronizando...';
  } else {
    btnSync.disabled = false;
    syncIcon.classList.remove('active');
    syncText.textContent = 'Atualizar Preços';
  }
}

function showSuccess(msg) {
  formSuccess.textContent = msg;
  formSuccess.classList.remove('hidden');
  setTimeout(() => formSuccess.classList.add('hidden'), 5000);
}

function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
  setTimeout(() => formError.classList.add('hidden'), 8000);
}

// Hide error/success feedback on add link form
function hideMessages() {
  formError.classList.add('hidden');
  formSuccess.classList.add('hidden');
}

// Format numbers to Brazilian currency string (e.g. 1390.5 -> "1.390,50")
function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Convert "2026-07-07" to "07/07/2026"
function formatDateString(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
