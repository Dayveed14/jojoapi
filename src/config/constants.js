// Shared vocabulary for the whole API. Change labels here, not in scattered code.

export const BOOKING_TYPES = ['full_purchase', 'sample_run'];
export const TIME_WINDOWS = ['morning', 'midday', 'afternoon'];

export const STATUS = {
  SUBMITTED: 'submitted',                       // waiting for Jojo to review
  AWAITING_CUSTOMER_APPROVAL: 'awaiting_customer_approval', // quote sent, customer to accept
  AWAITING_PAYMENT: 'awaiting_payment',          // quote accepted, upfront payment due
  PAID: 'paid',                                  // verified payment; scheduled
  SHOPPING_IN_PROGRESS: 'shopping_in_progress',
  AWAITING_CUSTOMER_DECISION: 'awaiting_customer_decision', // extra spend / substitution
  READY_FOR_DELIVERY: 'ready_for_delivery',      // full purchase: shopping done; sample run: results ready
  COMPLETED: 'completed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

export const STATUS_LABELS = {
  submitted: 'Waiting for review',
  awaiting_customer_approval: 'Quote ready — your approval needed',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid & scheduled',
  shopping_in_progress: 'Shopping in progress',
  awaiting_customer_decision: 'Your decision needed',
  ready_for_delivery: 'Shopping done — on the way',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Statuses that still hold capacity on the calendar. */
export const CAPACITY_STATUSES = [
  STATUS.SUBMITTED, STATUS.AWAITING_CUSTOMER_APPROVAL, STATUS.AWAITING_PAYMENT, STATUS.PAID,
  STATUS.SHOPPING_IN_PROGRESS, STATUS.AWAITING_CUSTOMER_DECISION, STATUS.READY_FOR_DELIVERY,
];

export const FINAL_STATUSES = [STATUS.COMPLETED, STATUS.DECLINED, STATUS.CANCELLED, STATUS.EXPIRED];

/** Customers may cancel only before shopping begins. */
export const CUSTOMER_CANCELLABLE = [STATUS.SUBMITTED, STATUS.AWAITING_CUSTOMER_APPROVAL, STATUS.AWAITING_PAYMENT, STATUS.PAID];

export const RESTOCK_STATUSES = ['unknown', 'still_available', 'running_low', 'finished'];
