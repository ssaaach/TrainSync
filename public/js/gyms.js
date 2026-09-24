// gyms.html — gyms by city.
document.getElementById('GymsearchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errorMessage = document.getElementById('errorMessage');
  errorMessage.textContent = '';
  const city = document.getElementById('city').value.trim();
  if (!city) return;

  try {
    const { ok, data: gyms } = await TS.api(`/api/gyms/${encodeURIComponent(city)}`);
    const resultsDiv = document.getElementById('gymResults');
    resultsDiv.innerHTML = '';

    if (!ok) {
      errorMessage.textContent = gyms.error || 'Server error. Try again.';
      return;
    }
    if (gyms.length === 0) {
      resultsDiv.innerHTML = '<p>No gyms found in this city.</p>';
      return;
    }

    document.getElementById('searchBox').style.display = 'none';
    document.getElementById('trainsynctitle').style.display = 'none';

    const esc = TS.escapeHTML;
    gyms.forEach(gym => {
      const addressIsLink = /^https?:/i.test(gym.address || '');
      const card = document.createElement('div');
      card.className = 'gym-card';
      card.innerHTML = `
        <h3>${esc(gym.name)}</h3>
        ${gym.address && !addressIsLink ? `<p><strong>Address:</strong> ${esc(gym.address)}</p>` : ''}
        ${gym.maps_url ? `<p><strong>Address:</strong> <a href="${esc(TS.safeUrl(gym.maps_url))}" target="_blank" rel="noopener">View Location</a></p>` : ''}
        ${gym.email ? `<p><strong>Email:</strong> ${esc(gym.email)}</p>` : ''}
        ${gym.phone ? `<p><strong>Phone:</strong> ${esc(gym.phone)}</p>` : ''}
        ${gym.website ? `<p><strong>Website:</strong> <a href="${esc(TS.safeUrl(gym.website))}" target="_blank" rel="noopener">View Website</a></p>` : ''}
      `;
      resultsDiv.appendChild(card);
    });
  } catch (err) {
    console.error('Error:', err);
    errorMessage.textContent = 'Server error. Try again.';
  }
});
