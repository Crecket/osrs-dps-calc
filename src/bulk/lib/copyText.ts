import { toast } from 'react-toastify';

/** Copies the text to the clipboard and says how that went; browsers without clipboard access get an error toast */
const copyText = async (text: string, what: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch {
    toast.error(`Could not copy ${what}: the browser blocked the clipboard`);
  }
};

export default copyText;
