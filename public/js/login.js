// login.html
document.addEventListener('DOMContentLoaded', async () => {
  const session = await TS.getSession();
  if (session.loggedIn) location.href = 'homepage1.html';
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorMessage = document.getElementById('errorMessage');
  errorMessage.innerText = '';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const { ok, data } = await TS.api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (ok) {
      window.location.href = 'homepage1.html';
    } else {
      errorMessage.innerText = data.error || data.message || 'Invalid email or password';
    }
  } catch (error) {
    console.error('Login error:', error);
    errorMessage.innerText = 'Something went wrong. Try again.';
  }
});
