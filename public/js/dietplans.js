// dietplans.html — curated diet plan by body type + goal.
document.getElementById('DietsearchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errorMessage = document.getElementById('errorMessage');
  errorMessage.textContent = '';
  const currentType = document.getElementById('currentType').value.trim();
  const goalType = document.getElementById('goalType').value.trim();
  if (!currentType || !goalType) return;

  try {
    const { ok, data: diet } = await TS.api(
      `/api/diets/${encodeURIComponent(currentType)}/${encodeURIComponent(goalType)}`
    );
    const dietDiv = document.getElementById('dietResults');
    dietDiv.innerHTML = '';

    if (!ok) {
      errorMessage.textContent = diet.message || diet.error || 'No matching diet found.';
      return;
    }

    document.getElementById('searchBox').style.display = 'none';
    document.getElementById('trainsynctitle').style.display = 'none';

    const macro = (label, value, unit = '') =>
      (value !== null && value !== undefined ? `<p><strong>${label}:</strong> ${TS.escapeHTML(value)}${unit}</p>` : '');

    const card = document.createElement('div');
    card.className = 'diet-card';
    card.innerHTML = `
      <h3>${TS.escapeHTML(diet.title)}</h3>
      ${diet.description ? `<p><strong>Description:</strong> ${TS.escapeHTML(diet.description)}</p>` : ''}
      ${diet.meals ? `<p><strong>Meals:</strong><br>${TS.multiline(diet.meals)}</p>` : ''}
      ${macro('Calories', diet.calories)}
      ${macro('Protein', diet.protein, 'g')}
      ${macro('Carbs', diet.carbs, 'g')}
      ${macro('Fats', diet.fats, 'g')}
    `;
    dietDiv.appendChild(card);
  } catch (err) {
    console.error('Error:', err);
    errorMessage.textContent = 'Server error. Try again.';
  }
});
