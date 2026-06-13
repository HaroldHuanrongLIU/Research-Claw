/**
 * Shared visual treatment for an unsaved (just-created, not-yet-persisted) API
 * profile. The provider picker modal and the inline profile list both reference
 * these so a draft reads identically in either surface.
 */
export const UNSAVED_PROFILE_BORDER = '1px dashed var(--accent-primary)';
export const UNSAVED_PROFILE_BG = 'rgba(96,165,250,0.08)';
/** i18n key for the "Draft · unsaved" marker shown on such a card. */
export const UNSAVED_PROFILE_TAG_KEY = 'providerPicker.unsavedDraft';
