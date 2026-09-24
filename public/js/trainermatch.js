// trainermatch.html — static demo carousel (replaced by the matching API in Phase 6).
const trainers = [
  { name: 'Trainer 1', specialty: 'Yoga', experience: '5 years' },
  { name: 'Trainer 2', specialty: 'Weightlifting', experience: '3 years' },
  { name: 'Trainer 3', specialty: 'Cardio', experience: '7 years' },
];

let currentTrainerIndex = 0;

function displayTrainer(index) {
  const trainer = trainers[index];
  document.getElementById('trainer-name').textContent = trainer.name;
  document.getElementById('trainer-specialty').textContent = `Specialty: ${trainer.specialty}`;
  document.getElementById('trainer-experience').textContent = `Experience: ${trainer.experience}`;
}

function nextTrainer() {
  currentTrainerIndex++;
  if (currentTrainerIndex >= trainers.length) {
    alert('No more trainers to show!');
  } else {
    displayTrainer(currentTrainerIndex);
  }
}

function matchTrainer() {
  const trainer = trainers[currentTrainerIndex];
  if (!trainer) return nextTrainer();
  alert(`You have matched with ${trainer.name}!`);
  nextTrainer();
}

document.getElementById('reject').addEventListener('click', nextTrainer);
document.getElementById('match').addEventListener('click', matchTrainer);
displayTrainer(currentTrainerIndex);
