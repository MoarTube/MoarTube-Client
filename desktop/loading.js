// Each phrase stands alone so any two different entries can be paired.
(() => {
  'use strict';

  const lines = [
    'Your media.',
    'Your rules.',
    'Your people.',
    'Your platform.',
    'Your voice.',
    'Your world.',
    'Your space.',
    'Your stage.',
    'Your stories.',
    'Your community.',
    'Your vision.',
    'Your channel.',
    'Your audience.',
    'Your creations.',
    'Your next idea.',
    'Your next chapter.',
    'Your own show.',
    'Your own way.',
    'Your kind of moar.',
    'Your place to play.',
    'Make it yours.',
    'Make it happen.',
    'Make something.',
    'Make some noise.',
    'Make a connection.',
    'Make your mark.',
    'Make waves.',
    'Make room.',
    'Make it count.',
    'Make moar.',
    'Share a moment.',
    'Share your world.',
    'Share your vision.',
    'Share your story.',
    'Share a little moar.',
    'Share something.',
    'Share the good.',
    'Share an idea.',
    'Share a spark.',
    'Share what matters.',
    'Create freely.',
    'Create your way.',
    'Create a little.',
    'Create a lot.',
    'Create a spark.',
    'Create a moment.',
    'Create a home.',
    'Create together.',
    'Create something.',
    'Create moar.',
    'Find your people.',
    'Find your rhythm.',
    'Find your voice.',
    'Find your spark.',
    'Find your space.',
    'Find a new angle.',
    'Find your next.',
    'Find a connection.',
    'Find a little moar.',
    'Find your community.',
    'Bring your ideas.',
    'Bring your people.',
    'Bring your vision.',
    'Bring your story.',
    'Bring your spark.',
    'Bring your voice.',
    'Bring the energy.',
    'Bring a new view.',
    'Bring it to life.',
    'Bring on moar.',
    'Press play.',
    'Take the stage.',
    'Take control.',
    'Take a new path.',
    'Take it live.',
    'Keep creating.',
    'Keep sharing.',
    'Keep exploring.',
    'Keep it yours.',
    'Keep it going.',
    'Think bigger.',
    'Dream a little.',
    'Try something new.',
    'Start something.',
    'Start with you.',
    'Go your own way.',
    'Go a little further.',
    'Go live.',
    'Build your world.',
    'Build a connection.',
    'Room to create.',
    'Room to grow.',
    'Room for your ideas.',
    'Room for your voice.',
    'Room for moar.',
    'Made to share.',
    'Made for moments.',
    'Made for your ideas.',
    'Made for your voice.',
    'Made for moar.',
  ];
  const heading = document.querySelector('.startup-headline');
  const top = document.getElementById('startup-line-top');
  const bottom = document.getElementById('startup-line-bottom');
  if (!heading || !top || !bottom) return;

  const first = Math.floor(Math.random() * lines.length);
  // Sample the other 99 entries equally, without repeating the first line.
  const second = Math.floor(Math.random() * (lines.length - 1));
  top.textContent = lines[first];
  bottom.textContent = lines[second >= first ? second + 1 : second];

  function fitHeadline() {
    heading.style.fontSize = '';
    const available = heading.clientWidth;
    const needed = Math.max(top.scrollWidth, bottom.scrollWidth);
    if (available > 0 && needed > available) {
      const size = parseFloat(getComputedStyle(heading).fontSize);
      heading.style.fontSize = Math.floor((size * (available - 2)) / needed) + 'px';
    }
  }

  fitHeadline();
  window.addEventListener('resize', fitHeadline);
  document.fonts.ready.then(fitHeadline);
})();
