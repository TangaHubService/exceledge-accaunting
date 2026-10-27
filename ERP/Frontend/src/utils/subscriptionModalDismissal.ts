// How long a dismissal lasts before the subscription-required modal is
// allowed to reopen on its own, independent of a fresh login or page
// refresh (both of which always reset it too, since this lives in module
// scope rather than localStorage/sessionStorage).
const DISMISS_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let dismissedAt: number | null = null;

export function dismissSubscriptionModal() {
    dismissedAt = Date.now();
}

/** Call after a successful login so a fresh session always re-evaluates the modal. */
export function resetSubscriptionModalDismissal() {
    dismissedAt = null;
}

export function isSubscriptionModalDismissalActive() {
    return dismissedAt !== null && Date.now() - dismissedAt < DISMISS_TIMEOUT_MS;
}
