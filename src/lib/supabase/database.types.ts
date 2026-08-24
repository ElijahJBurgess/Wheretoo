export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      events: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          admission_type: string
          animation_preset: string
          artwork_path: string | null
          capacity: number | null
          category: string | null
          city: string | null
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderation_status: string
          organizer_id: string
          postal_code: string | null
          published_at: string | null
          region: string | null
          starts_at: string | null
          status: string
          timezone: string
          title: string | null
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          admission_type?: string
          animation_preset?: string
          artwork_path?: string | null
          capacity?: number | null
          category?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          mapbox_feature_id?: string | null
          moderation_status?: string
          organizer_id: string
          postal_code?: string | null
          published_at?: string | null
          region?: string | null
          starts_at?: string | null
          status?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          admission_type?: string
          animation_preset?: string
          artwork_path?: string | null
          capacity?: number | null
          category?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          mapbox_feature_id?: string | null
          moderation_status?: string
          organizer_id?: string
          postal_code?: string | null
          published_at?: string | null
          region?: string | null
          starts_at?: string | null
          status?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizers: {
        Row: {
          base_city: string | null
          bio: string | null
          country_code: string
          created_at: string
          display_name: string
          id: string
          onboarding_completed_at: string | null
          organizer_type: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          base_city?: string | null
          bio?: string | null
          country_code?: string
          created_at?: string
          display_name: string
          id: string
          onboarding_completed_at?: string | null
          organizer_type?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          base_city?: string | null
          bio?: string | null
          country_code?: string
          created_at?: string
          display_name?: string
          id?: string
          onboarding_completed_at?: string | null
          organizer_type?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      publish_event: {
        Args: { p_event_id: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          admission_type: string
          animation_preset: string
          artwork_path: string | null
          capacity: number | null
          category: string | null
          city: string | null
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderation_status: string
          organizer_id: string
          postal_code: string | null
          published_at: string | null
          region: string | null
          starts_at: string | null
          status: string
          timezone: string
          title: string | null
          updated_at: string
          venue_name: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
