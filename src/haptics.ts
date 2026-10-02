import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Only in the apps: on the website the plugin falls back to navigator.vibrate, which buzzes rather than ticks.
const native = Capacitor.isNativePlatform();

/** A faint tick, for crossing a decade on the timeline or a sheet settling. */
export const tick = () => native && void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});

/** A firmer tap, for choosing something on the map. */
export const tap = () => native && void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
