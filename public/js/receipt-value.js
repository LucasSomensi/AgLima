(() => {
  const valueInput = document.querySelector('input[name="valor"]');
  if (!valueInput) return;

  function formatCents(value) {
    const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!digits) return '';

    const cents = digits.padStart(3, '0');
    return `${cents.slice(0, -2)},${cents.slice(-2)}`;
  }

  function updateValue() {
    valueInput.value = formatCents(valueInput.value);
  }

  valueInput.addEventListener('input', updateValue);
  updateValue();
})();
