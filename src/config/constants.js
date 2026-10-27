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

// ---------- Jojo's Kitchen ----------
export const KITCHEN_STATUS = {
  EXPRESS_REQUESTED: 'express_requested', // waiting for Jojo to say yes to an express time
  AWAITING_PAYMENT: 'awaiting_payment',
  CONFIRMED: 'confirmed',                 // paid; in the cooking schedule
  PREPARING: 'preparing',                 // buying fresh ingredients, prepping
  COOKING: 'cooking',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

export const KITCHEN_STATUS_LABELS = {
  express_requested: 'Express request — checking with Jojo',
  awaiting_payment: 'Awaiting payment',
  confirmed: 'Confirmed & scheduled',
  preparing: 'Preparing ingredients',
  cooking: 'Cooking',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Orders that use cooking capacity on their delivery day (awaiting_payment only while unexpired). */
export const KITCHEN_CAPACITY_STATUSES = ['awaiting_payment', 'confirmed', 'preparing', 'cooking', 'out_for_delivery', 'delivered'];
export const KITCHEN_ACTIVE_STATUSES = ['express_requested', 'awaiting_payment', 'confirmed', 'preparing', 'cooking', 'out_for_delivery'];

/** Things customers can ask Jojo to leave out. Each meal chooses which apply. */
export const KITCHEN_EXCLUSIONS = {
  no_garlic: 'No garlic',
  no_ginger: 'No ginger',
  no_onions: 'No onions',
  no_seasoning_cubes: 'No seasoning cubes (Maggi/Knorr)',
  no_msg: 'No MSG',
  no_crayfish: 'No crayfish',
  low_salt: 'Low salt',
  low_oil: 'Less oil',
  no_palm_oil: 'No palm oil',
  no_beef: 'No beef',
  no_shellfish: 'No shellfish / prawns',
  no_nuts: 'No nuts (allergy)',
};

export const MEAL_CATEGORIES = {
  rice: 'Rice dishes',
  soups: 'Soups & stews',
  swallow: 'Swallow',
  proteins: 'Proteins & pepper soup',
  small_chops: 'Small chops & snacks',
  sides: 'Sides',
  party: 'Party & bulk trays',
};
