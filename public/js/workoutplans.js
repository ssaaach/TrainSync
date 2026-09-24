// workoutplans.html — curated workout plan by body type + goal.
document.getElementById('WorkoutsearchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errorMessage = document.getElementById('errorMessage');
  errorMessage.textContent = '';
  const currentType = document.getElementById('currentType').value.trim();
  const goalType = document.getElementById('goalType').value.trim();
  if (!currentType || !goalType) return;

  try {
    const { ok, data: workout } = await TS.api(
      `/api/workouts/${encodeURIComponent(currentType)}/${encodeURIComponent(goalType)}`
    );
    const resultDiv = document.getElementById('dietResults');
    resultDiv.innerHTML = '';

    if (!ok) {
      errorMessage.textContent = workout.message || workout.error || 'No matching workout found.';
      return;
    }

    document.getElementById('searchBox').style.display = 'none';
    document.getElementById('trainsynctitle').style.display = 'none';

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const card = document.createElement('div');
    card.className = 'workout-card';
    card.innerHTML = `
      <h3>${TS.escapeHTML(workout.title)}</h3>
      ${workout.description ? `<p><strong>Description:</strong> ${TS.escapeHTML(workout.description)}</p>` : ''}
      ${days.filter(d => workout[d]).map(d => `
        <p><strong>${d[0].toUpperCase() + d.slice(1)}:</strong><br>${TS.multiline(workout[d])}</p>`).join('')}
    `;
    resultDiv.appendChild(card);
  } catch (err) {
    console.error('Error:', err);
    errorMessage.textContent = 'Server error. Try again.';
  }
});
