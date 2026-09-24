// registration.html
document.getElementById('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorMessage = document.getElementById('errorMessage');
  errorMessage.innerText = '';

  const body = {
    email: document.getElementById('email').value,
    name: document.getElementById('name').value,
    role: document.getElementById('role').value.trim().toLowerCase(),
    password: document.getElementById('password').value,
    confirmPassword: document.getElementById('confirmPassword').value,
  };

  try {
    const { ok, data } = await TS.api('/api/auth/register', { method: 'POST', body });
    if (ok) {
      window.location.href = 'login.html';
    } else {
      errorMessage.innerText = data.error || 'Registration failed.';
    }
  } catch (error) {
    console.error('Registration error:', error);
    errorMessage.innerText = 'Something went wrong. Try again.';
  }
});
