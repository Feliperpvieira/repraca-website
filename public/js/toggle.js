
// ----------------------------------- PROJECT LIST VIEW MORE AND LESS ------------------------
document.addEventListener('DOMContentLoaded', function() {
  const toggleButtons = document.querySelectorAll('.toggle-details-btn');

  toggleButtons.forEach(button => {
    button.addEventListener('click', function() {
      const details = this.querySelector('.toggle-content');
      const textElement = this.querySelector('.toggle-text');

      button.blur(); // Fixes sticky hover
      
      const isExpanded = this.classList.contains('expanded');
      const nextText = isExpanded ? 'View more' : 'View less';

      // --- Text Animation ---
      textElement.style.opacity = '0'; // 1. Fade the text out

      setTimeout(() => {
        textElement.textContent = nextText; // 2. Change the text when invisible
        textElement.style.opacity = '1'; // 3. Fade the new text in
      }, 200); // This delay (in ms) must match the CSS transition duration

      // --- Main Panel & Arrow Animation (happens in parallel) ---
      this.classList.toggle('expanded');

      if (!isExpanded) {
        // OPEN IT
        details.style.height = details.scrollHeight + 'px';
      } else {
        // CLOSE IT
        details.style.height = '0px';
      }
    });
  });
});