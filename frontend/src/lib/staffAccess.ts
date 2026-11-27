export type StaffRole = 'ADMIN' | 'SENDER' | 'VIEWER';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'DECLINED';
export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  status: 'NEW' | ReviewStatus;
  role: StaffRole | null;
  requestedAt: string | null;
  decidedAt: string | null;
}
export const roles: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  SENDER: 'Sender',
  VIEWER: 'Viewer',
};
