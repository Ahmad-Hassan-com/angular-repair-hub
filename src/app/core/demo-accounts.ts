/** Demo sign-ins shown on the login page (development data only). */
export const DEMO_PASSWORD = 'Demo@1234';

export const DEMO_ACCOUNTS: { email: string; role: string; label: string }[] = [
  { email: 'admin@repairhub.pk', role: 'Super admin', label: 'Full platform control' },
  { email: 'ops@repairhub.pk', role: 'Operations staff', label: 'Jobs, deliveries, complaints' },
  { email: 'fixit@repairhub.pk', role: 'Vendor', label: 'FixIt Mobile Lab, Lahore' },
  { email: 'techcare@repairhub.pk', role: 'Vendor', label: 'TechCare Repairs, Lahore' },
  { email: 'sara@example.pk', role: 'Customer', label: 'Has a quotation to approve' },
  { email: 'rider@repairhub.pk', role: 'Delivery agent', label: 'Pickup and delivery tasks' },
];
