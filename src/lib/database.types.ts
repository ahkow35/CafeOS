export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      // NOTE: café-scoped employment fields (job_title, leave balances, hourly_rate)
      // are DEPRECATED on profiles and now live on cafe_memberships (Option A).
      // They remain here until the columns are dropped after prod soak.
      profiles: {
        Row: {
          id: string;
          phone_e164: string;
          full_name: string;
          job_title: string | null;
          role: 'staff' | 'manager' | 'owner' | 'part_timer';
          annual_leave_balance: number;
          medical_leave_balance: number;
          is_active: boolean;
          hourly_rate: number | null;
          email: string | null;
          telegram_chat_id: string | null;
          token_version: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone_e164: string;
          full_name: string;
          job_title?: string | null;
          role?: 'staff' | 'manager' | 'owner' | 'part_timer';
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          is_active?: boolean;
          hourly_rate?: number | null;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone_e164?: string;
          full_name?: string;
          job_title?: string | null;
          role?: 'staff' | 'manager' | 'owner' | 'part_timer';
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          is_active?: boolean;
          hourly_rate?: number | null;
          email?: string | null;
          telegram_chat_id?: string | null;
          token_version?: number;
          created_at?: string;
        };
      };
      cafe_memberships: {
        Row: {
          id: string;
          cafe_id: string;
          user_id: string;
          role: 'staff' | 'manager' | 'owner' | 'part_timer';
          status: 'pending' | 'active' | 'suspended';
          job_title: string | null;
          annual_leave_balance: number;
          medical_leave_balance: number;
          hourly_rate: number | null;
          employment_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          cafe_id: string;
          user_id: string;
          role: 'staff' | 'manager' | 'owner' | 'part_timer';
          status?: 'pending' | 'active' | 'suspended';
          job_title?: string | null;
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          hourly_rate?: number | null;
          employment_active?: boolean;
          created_at?: string;
        };
        Update: {
          role?: 'staff' | 'manager' | 'owner' | 'part_timer';
          status?: 'pending' | 'active' | 'suspended';
          job_title?: string | null;
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          hourly_rate?: number | null;
          employment_active?: boolean;
        };
      };
      leave_requests: {
        Row: {
          id: string;
          user_id: string;
          leave_type: 'annual' | 'medical';
          start_date: string;
          end_date: string;
          days_requested: number;
          reason: string | null;
          attachment_url: string | null;
          is_retrospective: boolean;
          status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
          manager_action_by: string | null;
          manager_action_at: string | null;
          owner_action_by: string | null;
          owner_action_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          leave_type: 'annual' | 'medical';
          start_date: string;
          end_date: string;
          days_requested: number;
          reason?: string | null;
          attachment_url?: string | null;
          is_retrospective?: boolean;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
          manager_action_by?: string | null;
          manager_action_at?: string | null;
          owner_action_by?: string | null;
          owner_action_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          leave_type?: 'annual' | 'medical';
          start_date?: string;
          end_date?: string;
          days_requested?: number;
          reason?: string | null;
          attachment_url?: string | null;
          is_retrospective?: boolean;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
          manager_action_by?: string | null;
          manager_action_at?: string | null;
          owner_action_by?: string | null;
          owner_action_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          deadline: string;
          assigned_to: string;
          status: 'pending' | 'done';
          created_by: string;
          completed_by: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          deadline: string;
          assigned_to: string;
          status?: 'pending' | 'done';
          created_by: string;
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          deadline?: string;
          assigned_to?: string;
          status?: 'pending' | 'done';
          created_by?: string;
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

export type User = Database['public']['Tables']['profiles']['Row'];
export type LeaveRequest = Database['public']['Tables']['leave_requests']['Row'];
export type Task = Database['public']['Tables']['tasks']['Row'];

export type UserRole = User['role'];
export type LeaveStatus = LeaveRequest['status'];
export type TimesheetStatus = 'draft' | 'submitted' | 'pending_owner' | 'approved' | 'rejected';

export interface Timesheet {
  id: string;
  user_id: string;
  month_year: string; // 'YYYY-MM'
  status: TimesheetStatus;
  comments: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  manager_action_by: string | null;
  manager_action_at: string | null;
  employee_signature: string | null;
  manager_signature: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimesheetEntry {
  id: string;
  timesheet_id: string;
  entry_date: string; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM'
  end_time: string | null;   // 'HH:MM'
  break_hours: number;
  total_hours: number;
  remarks: string | null;
  created_at: string;
}

export interface TimesheetWithEntries extends Timesheet {
  entries: TimesheetEntry[];
  profile?: Pick<User, 'full_name' | 'email' | 'phone_e164' | 'hourly_rate'>;
}
