/**
 * Keyboard inset.
 *
 * This app runs edge-to-edge (`edgeToEdgeEnabled=true`), so Android no longer
 * shrinks the window when the IME opens — `adjustResize` is a no-op and the
 * keyboard overlays anything anchored to the bottom. This hook measures the
 * real overlap between the app window and the top of the keyboard, so screens
 * can pad just enough.
 *
 * If a device *does* resize the window (adjustResize honoured), the window
 * height already ends where the keyboard begins and the computed overlap is ~0,
 * so there is no double padding.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, type KeyboardEvent, Platform } from 'react-native';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const { screenY } = e.endCoordinates;
      const appHeight = Dimensions.get('window').height;
      // Overlap = how far the app window extends below the keyboard's top edge.
      setInset(Math.max(0, Math.round(appHeight - screenY)));
    };
    const onHide = () => setInset(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
