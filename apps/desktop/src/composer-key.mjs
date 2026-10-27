export function submitOnEnter(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229) return;
  event.preventDefault();
  const form = event.currentTarget.form;
  const submit = form?.querySelector('button.send');
  if (submit && !submit.disabled) form.requestSubmit(submit);
}
