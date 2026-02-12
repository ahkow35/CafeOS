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
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: 'staff' | 'manager' | 'owner';
          annual_leave_balance: number;
          medical_leave_balance: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role?: 'staff' | 'manager' | 'owner';
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: 'staff' | 'manager' | 'owner';
          annual_leave_balance?: number;
          medical_leave_balance?: number;
          is_active?: boolean;
          created_at?: string;
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
    Functions: {
      is_manager_or_owner: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_owner: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
  };
}

export type User = Database['public']['Tables']['profiles']['Row'];
export type LeaveRequest = Database['public']['Tables']['leave_requests']['Row'];
export type Task = Database['public']['Tables']['tasks']['Row'];

export type UserRole = User['role'];
export type LeaveStatus = LeaveRequest['status'];
