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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      disputes: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          first_stripe_event_created_at: string
          first_stripe_event_id: string
          id: string
          last_stripe_event_created_at: string
          last_stripe_event_id: string
          order_id: string
          recovery_status: string
          status: string
          stripe_charge_id: string
          stripe_dispute_id: string
          stripe_payment_intent_id: string | null
          stripe_transfer_reversal_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          first_stripe_event_created_at: string
          first_stripe_event_id: string
          id?: string
          last_stripe_event_created_at: string
          last_stripe_event_id: string
          order_id: string
          recovery_status: string
          status: string
          stripe_charge_id: string
          stripe_dispute_id: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_reversal_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          first_stripe_event_created_at?: string
          first_stripe_event_id?: string
          id?: string
          last_stripe_event_created_at?: string
          last_stripe_event_id?: string
          order_id?: string
          recovery_status?: string
          status?: string
          stripe_charge_id?: string
          stripe_dispute_id?: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_reversal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_first_stripe_event_id_fkey"
            columns: ["first_stripe_event_id"]
            isOneToOne: false
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["stripe_event_id"]
          },
          {
            foreignKeyName: "disputes_last_stripe_event_id_fkey"
            columns: ["last_stripe_event_id"]
            isOneToOne: false
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["stripe_event_id"]
          },
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
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
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
          content_revision?: number
          country_code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          first_publicly_eligible_at?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          mapbox_feature_id?: string | null
          moderated_revision?: number | null
          moderation_status?: string
          moderation_updated_at?: string | null
          moderation_version?: number
          organizer_id: string
          postal_code?: string | null
          public_eligibility_version?: number
          public_history_status?: string
          publicly_authorized_action_id?: string | null
          publicly_authorized_revision?: number | null
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
          content_revision?: number
          country_code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          first_publicly_eligible_at?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          mapbox_feature_id?: string | null
          moderated_revision?: number | null
          moderation_status?: string
          moderation_updated_at?: string | null
          moderation_version?: number
          organizer_id?: string
          postal_code?: string | null
          public_eligibility_version?: number
          public_history_status?: string
          publicly_authorized_action_id?: string | null
          publicly_authorized_revision?: number | null
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
      order_items: {
        Row: {
          created_at: string
          currency: string
          id: string
          order_id: string
          quantity: number
          subtotal_minor: number
          ticket_tier_id: string
          tier_description: string | null
          tier_name: string
          tier_version: number
          unit_amount_minor: number
        }
        Insert: {
          created_at?: string
          currency: string
          id?: string
          order_id: string
          quantity: number
          subtotal_minor: number
          ticket_tier_id: string
          tier_description?: string | null
          tier_name: string
          tier_version: number
          unit_amount_minor: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          quantity?: number
          subtotal_minor?: number
          ticket_tier_id?: string
          tier_description?: string | null
          tier_name?: string
          tier_version?: number
          unit_amount_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_tier_id_fkey"
            columns: ["ticket_tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          actual_organizer_proceeds_minor: number | null
          actual_stripe_fee_minor: number | null
          application_fee_amount_minor: number
          buyer_email: string
          buyer_name: string
          checkout_expires_at: string | null
          client_request_id: string
          confirmation_token_hash: string
          created_at: string
          currency: string
          event_id: string
          expected_organizer_proceeds_minor: number
          expired_at: string | null
          failed_at: string | null
          failure_code: string | null
          fee_rule_id: string
          id: string
          last_stripe_event_id: string | null
          livemode: boolean
          order_number: string
          organizer_id: string
          paid_at: string | null
          platform_fixed_minor: number
          platform_percent_bps: number
          platform_product_fee_minor: number
          processing_estimate_fixed_minor: number | null
          processing_estimate_percent_bps: number | null
          processing_fee_treatment: string
          quantity: number
          reconciliation_status: string
          refunded_at: string | null
          reservation_expires_at: string | null
          status: string
          stripe_application_fee_id: string | null
          stripe_balance_transaction_id: string | null
          stripe_charge_id: string | null
          stripe_checkout_integration_identifier: string
          stripe_checkout_request_digest: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_destination_account_id: string
          stripe_fee_estimate_minor: number
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          subtotal_minor: number
          tax_amount_minor: number
          total_minor: number
          updated_at: string
        }
        Insert: {
          actual_organizer_proceeds_minor?: number | null
          actual_stripe_fee_minor?: number | null
          application_fee_amount_minor: number
          buyer_email: string
          buyer_name: string
          checkout_expires_at?: string | null
          client_request_id: string
          confirmation_token_hash: string
          created_at?: string
          currency: string
          event_id: string
          expected_organizer_proceeds_minor: number
          expired_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          fee_rule_id: string
          id?: string
          last_stripe_event_id?: string | null
          livemode?: boolean
          order_number: string
          organizer_id: string
          paid_at?: string | null
          platform_fixed_minor: number
          platform_percent_bps: number
          platform_product_fee_minor: number
          processing_estimate_fixed_minor?: number | null
          processing_estimate_percent_bps?: number | null
          processing_fee_treatment: string
          quantity: number
          reconciliation_status?: string
          refunded_at?: string | null
          reservation_expires_at?: string | null
          status?: string
          stripe_application_fee_id?: string | null
          stripe_balance_transaction_id?: string | null
          stripe_charge_id?: string | null
          stripe_checkout_integration_identifier: string
          stripe_checkout_request_digest: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_destination_account_id: string
          stripe_fee_estimate_minor?: number
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          subtotal_minor: number
          tax_amount_minor?: number
          total_minor: number
          updated_at?: string
        }
        Update: {
          actual_organizer_proceeds_minor?: number | null
          actual_stripe_fee_minor?: number | null
          application_fee_amount_minor?: number
          buyer_email?: string
          buyer_name?: string
          checkout_expires_at?: string | null
          client_request_id?: string
          confirmation_token_hash?: string
          created_at?: string
          currency?: string
          event_id?: string
          expected_organizer_proceeds_minor?: number
          expired_at?: string | null
          failed_at?: string | null
          failure_code?: string | null
          fee_rule_id?: string
          id?: string
          last_stripe_event_id?: string | null
          livemode?: boolean
          order_number?: string
          organizer_id?: string
          paid_at?: string | null
          platform_fixed_minor?: number
          platform_percent_bps?: number
          platform_product_fee_minor?: number
          processing_estimate_fixed_minor?: number | null
          processing_estimate_percent_bps?: number | null
          processing_fee_treatment?: string
          quantity?: number
          reconciliation_status?: string
          refunded_at?: string | null
          reservation_expires_at?: string | null
          status?: string
          stripe_application_fee_id?: string | null
          stripe_balance_transaction_id?: string | null
          stripe_charge_id?: string | null
          stripe_checkout_integration_identifier?: string
          stripe_checkout_request_digest?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_destination_account_id?: string
          stripe_fee_estimate_minor?: number
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          subtotal_minor?: number
          tax_amount_minor?: number
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_fee_rule_id_fkey"
            columns: ["fee_rule_id"]
            isOneToOne: false
            referencedRelation: "platform_fee_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_last_stripe_event_id_fkey"
            columns: ["last_stripe_event_id"]
            isOneToOne: false
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["stripe_event_id"]
          },
          {
            foreignKeyName: "orders_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_stripe_accounts: {
        Row: {
          country_code: string
          created_at: string
          currency: string
          dashboard: string
          fees_collector: string
          last_status_code: string | null
          last_sync_sequence: number
          last_synced_at: string
          livemode: boolean
          losses_collector: string
          organizer_id: string
          payouts_status: string
          requirements_currently_due_count: number
          requirements_past_due_count: number
          requirements_status: string
          stripe_account_id: string
          transfers_status: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          dashboard?: string
          fees_collector?: string
          last_status_code?: string | null
          last_sync_sequence?: number
          last_synced_at?: string
          livemode?: boolean
          losses_collector?: string
          organizer_id: string
          payouts_status?: string
          requirements_currently_due_count?: number
          requirements_past_due_count?: number
          requirements_status?: string
          stripe_account_id: string
          transfers_status?: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          dashboard?: string
          fees_collector?: string
          last_status_code?: string | null
          last_sync_sequence?: number
          last_synced_at?: string
          livemode?: boolean
          losses_collector?: string
          organizer_id?: string
          payouts_status?: string
          requirements_currently_due_count?: number
          requirements_past_due_count?: number
          requirements_status?: string
          stripe_account_id?: string
          transfers_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_stripe_accounts_organizer_id_fkey"
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
      platform_fee_rules: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_until: string | null
          id: string
          livemode: boolean
          platform_fixed_minor: number
          platform_percent_bps: number
          processing_estimate_fixed_minor: number | null
          processing_estimate_percent_bps: number | null
          processing_fee_treatment: string
        }
        Insert: {
          created_at?: string
          currency: string
          effective_from: string
          effective_until?: string | null
          id?: string
          livemode?: boolean
          platform_fixed_minor: number
          platform_percent_bps: number
          processing_estimate_fixed_minor?: number | null
          processing_estimate_percent_bps?: number | null
          processing_fee_treatment: string
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          livemode?: boolean
          platform_fixed_minor?: number
          platform_percent_bps?: number
          processing_estimate_fixed_minor?: number | null
          processing_estimate_percent_bps?: number | null
          processing_fee_treatment?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_minor: number
          application_fee_refund_amount_minor: number
          created_at: string
          currency: string
          id: string
          order_id: string
          policy_failure_code: string | null
          policy_verified: boolean
          processed_at: string | null
          reason: string | null
          refund_application_fee: boolean
          reverse_transfer: boolean
          status: string
          stripe_application_fee_refund_id: string | null
          stripe_charge_id: string | null
          stripe_event_id: string
          stripe_payment_intent_id: string | null
          stripe_refund_id: string
          stripe_transfer_reversal_id: string | null
          transfer_reversal_amount_minor: number
          updated_at: string
        }
        Insert: {
          amount_minor: number
          application_fee_refund_amount_minor?: number
          created_at?: string
          currency: string
          id?: string
          order_id: string
          policy_failure_code?: string | null
          policy_verified?: boolean
          processed_at?: string | null
          reason?: string | null
          refund_application_fee: boolean
          reverse_transfer: boolean
          status: string
          stripe_application_fee_refund_id?: string | null
          stripe_charge_id?: string | null
          stripe_event_id: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id: string
          stripe_transfer_reversal_id?: string | null
          transfer_reversal_amount_minor?: number
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          application_fee_refund_amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          policy_failure_code?: string | null
          policy_verified?: boolean
          processed_at?: string | null
          reason?: string | null
          refund_application_fee?: boolean
          reverse_transfer?: boolean
          status?: string
          stripe_application_fee_refund_id?: string | null
          stripe_charge_id?: string | null
          stripe_event_id?: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string
          stripe_transfer_reversal_id?: string | null
          transfer_reversal_amount_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_stripe_event_id_fkey"
            columns: ["stripe_event_id"]
            isOneToOne: false
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["stripe_event_id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          api_version: string | null
          delivery_attempt_count: number
          error_code: string | null
          event_type: string
          first_received_at: string
          last_received_at: string
          livemode: boolean
          payload_sha256: string
          processed_at: string | null
          processing_status: string
          stripe_created_at: string
          stripe_event_id: string
          stripe_object_id: string | null
        }
        Insert: {
          api_version?: string | null
          delivery_attempt_count?: number
          error_code?: string | null
          event_type: string
          first_received_at?: string
          last_received_at?: string
          livemode?: boolean
          payload_sha256: string
          processed_at?: string | null
          processing_status?: string
          stripe_created_at: string
          stripe_event_id: string
          stripe_object_id?: string | null
        }
        Update: {
          api_version?: string | null
          delivery_attempt_count?: number
          error_code?: string | null
          event_type?: string
          first_received_at?: string
          last_received_at?: string
          livemode?: boolean
          payload_sha256?: string
          processed_at?: string | null
          processing_status?: string
          stripe_created_at?: string
          stripe_event_id?: string
          stripe_object_id?: string | null
        }
        Relationships: []
      }
      ticket_tiers: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          name: string
          quantity_total: number
          sort_order: number
          status: string
          unit_amount_minor: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          event_id: string
          id?: string
          name: string
          quantity_total: number
          sort_order: number
          status?: string
          unit_amount_minor: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          event_id?: string
          id?: string
          name?: string
          quantity_total?: number
          sort_order?: number
          status?: string
          unit_amount_minor?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          cancelled_at: string | null
          event_id: string
          id: string
          issued_at: string
          order_id: string
          order_item_id: string
          organizer_id: string
          refunded_at: string | null
          status: string
          ticket_tier_id: string
          unit_sequence: number
        }
        Insert: {
          cancelled_at?: string | null
          event_id: string
          id?: string
          issued_at?: string
          order_id: string
          order_item_id: string
          organizer_id: string
          refunded_at?: string | null
          status?: string
          ticket_tier_id: string
          unit_sequence: number
        }
        Update: {
          cancelled_at?: string | null
          event_id?: string
          id?: string
          issued_at?: string
          order_id?: string
          order_item_id?: string
          organizer_id?: string
          refunded_at?: string | null
          status?: string
          ticket_tier_id?: string
          unit_sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_tier_id_fkey"
            columns: ["ticket_tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_current_event_policies: {
        Args: { p_event_id: string }
        Returns: {
          alcohol_present: boolean
          cannabis_present: boolean
          event_policy_label: string
          event_policy_stage: string
          event_policy_url: string
          event_policy_version_id: string
          explicit_adult_content: boolean
          gambling_present: boolean
          high_risk_activity: boolean
          minimum_age: string
          needs_acceptance: boolean
          organizer_terms_label: string
          organizer_terms_stage: string
          organizer_terms_url: string
          organizer_terms_version_id: string
          weapons_present: boolean
        }[]
      }
      activate_paid_sales: {
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
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
      activate_paid_sales_locked: {
        Args: { p_event_id: string; p_require_draft_paid: boolean }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          admission_type: string
          animation_preset: string
          artwork_path: string | null
          capacity: number | null
          category: string | null
          city: string | null
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
      get_current_event_review_request: {
        Args: { p_event_id: string }
        Returns: {
          created_at: string
          id: string
          resolved_at: string
          status: string
        }[]
      }
      get_moderation_case: {
        Args: { p_event_id: string }
        Returns: {
          actions: Json
          address_line1: string
          address_line2: string
          category: string
          city: string
          content_revision: number
          country_code: string
          current_open_review_request: boolean
          current_report_count: number
          description: string
          disclosures: Json
          ends_at: string
          evaluations: Json
          event_id: string
          first_publicly_eligible_at: string
          input_sha256: string
          latitude: number
          legacy_resolution: Json
          longitude: number
          mapbox_feature_id: string
          moderation_status: string
          moderation_version: number
          organizer_id: string
          postal_code: string
          public_history_status: string
          region: string
          starts_at: string
          timezone: string
          title: string
          venue_name: string
        }[]
      }
      get_my_staff_role: { Args: never; Returns: string }
      get_owned_event_requirements: {
        Args: { p_event_id: string }
        Returns: {
          alcohol_present: boolean
          cannabis_present: boolean
          event_policy_label: string
          event_policy_stage: string
          event_policy_url: string
          event_policy_version_id: string
          explicit_adult_content: boolean
          gambling_present: boolean
          high_risk_activity: boolean
          minimum_age: string
          needs_acceptance: boolean
          organizer_terms_label: string
          organizer_terms_stage: string
          organizer_terms_url: string
          organizer_terms_version_id: string
          weapons_present: boolean
        }[]
      }
      get_public_event: { Args: { p_event_id: string }; Returns: Json[] }
      get_public_event_ticketing: {
        Args: { p_event_id: string }
        Returns: Json[]
      }
      get_public_map_events: {
        Args: {
          p_categories?: string[]
          p_east: number
          p_ends_at: string
          p_north: number
          p_south: number
          p_starts_at: string
          p_west: number
        }
        Returns: {
          admission_type: string
          advisories: string[]
          animation_preset: string
          artwork_reference: string
          category: string
          ends_at: string
          event_id: string
          latitude: number
          longitude: number
          minimum_age: string
          minimum_price_minor: number
          starts_at: string
          timezone: string
          title: string
          venue_label: string
        }[]
      }
      get_required_event_policies: {
        Args: never
        Returns: {
          effective_at: string
          label: string
          policy_kind: string
          public_url: string
          stage: string
          version_id: string
        }[]
      }
      list_moderation_queue: {
        Args: { p_limit: number }
        Returns: {
          content_revision: number
          current_open_review_request: boolean
          current_report_count: number
          event_id: string
          input_sha256: string
          moderation_status: string
          moderation_version: number
          oldest_queued_at: string
          organizer_id: string
          public_history_status: string
          queued_evaluation_count: number
        }[]
      }
      list_owned_ticket_tiers: {
        Args: { p_event_id: string }
        Returns: {
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          name: string
          quantity_total: number
          sort_order: number
          status: string
          unit_amount_minor: number
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_tiers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lock_event_ticketing_operation: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      moderate_event: {
        Args: {
          p_action: string
          p_event_id: string
          p_expected_content_revision: number
          p_expected_input_sha256: string
          p_expected_moderation_version: number
          p_internal_note: string
          p_reason_code: string
        }
        Returns: string
      }
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
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
      request_event_review: {
        Args: { p_event_id: string; p_organizer_note: string }
        Returns: string
      }
      resolve_legacy_public_history: {
        Args: {
          p_event_id: string
          p_evidence_code: string
          p_expected_content_revision: number
          p_expected_input_sha256: string
          p_expected_moderation_version: number
          p_internal_note: string
          p_observed_public_at: string
          p_public_history_status: string
        }
        Returns: string
      }
      save_owned_event_requirements: {
        Args: { p_event_id: string; p_requirements: Json }
        Returns: {
          alcohol_present: boolean
          cannabis_present: boolean
          explicit_adult_content: boolean
          gambling_present: boolean
          high_risk_activity: boolean
          minimum_age: string
          weapons_present: boolean
        }[]
      }
      save_owned_event_revision: {
        Args: { p_event: Json; p_event_id: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          admission_type: string
          animation_preset: string
          artwork_path: string | null
          capacity: number | null
          category: string | null
          city: string | null
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
      save_owned_event_revision_without_value_validation: {
        Args: { p_event: Json; p_event_id: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          admission_type: string
          animation_preset: string
          artwork_path: string | null
          capacity: number | null
          category: string | null
          city: string | null
          content_revision: number
          country_code: string
          created_at: string
          description: string | null
          ends_at: string | null
          first_publicly_eligible_at: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          mapbox_feature_id: string | null
          moderated_revision: number | null
          moderation_status: string
          moderation_updated_at: string | null
          moderation_version: number
          organizer_id: string
          postal_code: string | null
          public_eligibility_version: number
          public_history_status: string
          publicly_authorized_action_id: string | null
          publicly_authorized_revision: number | null
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
      save_owned_organizer_profile: {
        Args: { p_profile: Json }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "organizers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_owned_organizer_profile_without_value_validation: {
        Args: { p_profile: Json }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "organizers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_ticket_tiers: {
        Args: { p_event_id: string; p_tiers: Json }
        Returns: {
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          name: string
          quantity_total: number
          sort_order: number
          status: string
          unit_amount_minor: number
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_tiers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_ticket_tiers_without_active_free_guard: {
        Args: { p_event_id: string; p_tiers: Json }
        Returns: {
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          name: string
          quantity_total: number
          sort_order: number
          status: string
          unit_amount_minor: number
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_tiers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_ticket_tiers_without_revision: {
        Args: { p_event_id: string; p_tiers: Json }
        Returns: {
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          name: string
          quantity_total: number
          sort_order: number
          status: string
          unit_amount_minor: number
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_tiers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      server_apply_dispute: {
        Args: {
          p_amount_minor: number
          p_charge_id: string
          p_currency: string
          p_order_id: string
          p_recovery_status: string
          p_status: string
          p_stripe_dispute_id: string
          p_stripe_event_id: string
        }
        Returns: string
      }
      server_apply_moderation_evaluation: {
        Args: {
          p_content_revision: number
          p_evaluation_id: string
          p_input_sha256: string
          p_model_version: string
          p_outcome: string
          p_provider_reference: string
          p_queued_moderation_version: number
          p_reason_codes: string[]
          p_risk_level: string
        }
        Returns: string
      }
      server_apply_refund: {
        Args: {
          p_amount_minor: number
          p_charge_id: string
          p_currency: string
          p_order_id: string
          p_payment_intent_id: string
          p_reason: string
          p_refund_application_fee: boolean
          p_reverse_transfer: boolean
          p_status: string
          p_stripe_event_id: string
          p_stripe_refund_id: string
        }
        Returns: {
          order_id: string
          order_status: string
          ticket_status: string
        }[]
      }
      server_apply_verified_dispute: {
        Args: {
          p_amount_minor: number
          p_charge_id: string
          p_currency: string
          p_order_id: string
          p_payment_intent_id: string
          p_recovery_status: string
          p_status: string
          p_stripe_dispute_id: string
          p_stripe_event_id: string
          p_transfer_reversal_id: string
        }
        Returns: string
      }
      server_apply_verified_refund: {
        Args: {
          p_amount_minor: number
          p_application_fee_refund_amount_minor: number
          p_application_fee_refund_id: string
          p_charge_id: string
          p_currency: string
          p_order_id: string
          p_payment_intent_id: string
          p_policy_failure_code: string
          p_policy_verified: boolean
          p_reason: string
          p_refund_application_fee: boolean
          p_reverse_transfer: boolean
          p_status: string
          p_stripe_event_id: string
          p_stripe_refund_id: string
          p_transfer_reversal_amount_minor: number
          p_transfer_reversal_id: string
        }
        Returns: {
          order_id: string
          order_status: string
          ticket_status: string
        }[]
      }
      server_attach_checkout_session: {
        Args: { p_expires_at: string; p_order_id: string; p_session_id: string }
        Returns: string
      }
      server_begin_connect_refresh: {
        Args: { p_stripe_account_id: string }
        Returns: number
      }
      server_cancel_checkout_reservation: {
        Args: { p_order_id: string; p_reason: string }
        Returns: string
      }
      server_claim_moderation_evaluation: {
        Args: { p_worker_reference: string }
        Returns: {
          attempt_count: number
          content_revision: number
          evaluation_id: string
          event_id: string
          input_sha256: string
          moderation_input: Json
          prior_reason_codes: string[]
          queued_moderation_version: number
        }[]
      }
      server_consume_checkout_rate_limit: {
        Args: { p_identity_hash: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      server_expire_checkout_reservations: {
        Args: { p_now: string }
        Returns: number
      }
      server_expire_event_report_fingerprints: { Args: never; Returns: number }
      server_fail_moderation_evaluation: {
        Args: {
          p_content_revision: number
          p_evaluation_id: string
          p_failure_code: string
          p_input_sha256: string
          p_queued_moderation_version: number
        }
        Returns: string
      }
      server_finalize_webhook_receipt: {
        Args: {
          p_error_code: string
          p_processing_status: string
          p_stripe_event_id: string
        }
        Returns: string
      }
      server_fulfill_paid_order: {
        Args: {
          p_application_fee_amount_minor: number
          p_application_fee_id: string
          p_balance_transaction_id: string
          p_charge_id: string
          p_checkout_session_id: string
          p_currency: string
          p_customer_id: string
          p_destination_account_id: string
          p_mode: string
          p_order_id: string
          p_payment_intent_id: string
          p_payment_status: string
          p_stripe_event_id: string
          p_subtotal_minor: number
          p_total_minor: number
          p_transfer_id: string
        }
        Returns: {
          order_id: string
          order_status: string
          ticket_count: number
        }[]
      }
      server_get_checkout_integrity_order_snapshot: {
        Args: { p_checkout_session_id: string; p_order_id: string }
        Returns: {
          application_fee_amount_minor: number
          checkout_session_id: string
          currency: string
          destination_account_id: string
          event_id: string
          order_id: string
          order_items: Json
          subtotal_minor: number
          total_minor: number
        }[]
      }
      server_get_checkout_integrity_payment_snapshot: {
        Args: { p_order_id: string }
        Returns: {
          application_fee_amount_minor: number
          checkout_session_id: string
          currency: string
          destination_account_id: string
          event_id: string
          order_id: string
          order_items: Json
          subtotal_minor: number
          total_minor: number
        }[]
      }
      server_get_checkout_preflight:
        | {
            Args: { p_event_id: string; p_tier_id: string }
            Returns: {
              organizer_id: string
              stripe_account_id: string
            }[]
          }
        | {
            Args: { p_event_id: string; p_tier_ids: string[] }
            Returns: {
              organizer_id: string
              stripe_account_id: string
            }[]
          }
      server_get_webhook_order_snapshot: {
        Args: { p_checkout_session_id: string; p_order_id: string }
        Returns: {
          application_fee_amount_minor: number
          currency: string
          destination_account_id: string
          event_id: string
          order_id: string
          subtotal_minor: number
          tier_id: string
          total_minor: number
        }[]
      }
      server_get_webhook_payment_order_snapshot: {
        Args: { p_order_id: string }
        Returns: {
          application_fee_amount_minor: number
          checkout_session_id: string
          currency: string
          destination_account_id: string
          event_id: string
          order_id: string
          subtotal_minor: number
          tier_id: string
          total_minor: number
        }[]
      }
      server_lookup_checkout_cancellation: {
        Args: { p_token_hash: string }
        Returns: {
          order_id: string
          status: string
          stripe_checkout_session_id: string
        }[]
      }
      server_lookup_checkout_integrity_confirmation: {
        Args: { p_token_hash: string }
        Returns: {
          confirmation_status: string
          currency: string
          event_ends_at: string
          event_starts_at: string
          event_timezone: string
          event_title: string
          event_venue_name: string
          items: Json
          order_number: string
          quantity: number
          subtotal_minor: number
          tax_amount_minor: number
          total_minor: number
        }[]
      }
      server_lookup_order_confirmation: {
        Args: { p_token_hash: string }
        Returns: {
          confirmation_status: string
          event_ends_at: string
          event_starts_at: string
          event_timezone: string
          event_title: string
          event_venue_name: string
          order_number: string
          tier_name: string
        }[]
      }
      server_mark_checkout_reconciliation_review: {
        Args: {
          p_checkout_session_id: string
          p_failure_code: string
          p_order_id: string
          p_stripe_event_id: string
        }
        Returns: string
      }
      server_mark_payment_failed: {
        Args: {
          p_application_fee_amount_minor: number
          p_checkout_session_id: string
          p_currency: string
          p_destination_account_id: string
          p_failure_code: string
          p_mode: string
          p_order_id: string
          p_payment_intent_id: string
          p_payment_status: string
          p_stripe_event_id: string
          p_subtotal_minor: number
          p_total_minor: number
        }
        Returns: string
      }
      server_mark_payment_processing: {
        Args: {
          p_application_fee_amount_minor: number
          p_checkout_session_id: string
          p_currency: string
          p_destination_account_id: string
          p_mode: string
          p_order_id: string
          p_payment_intent_id: string
          p_payment_status: string
          p_stripe_event_id: string
          p_subtotal_minor: number
          p_total_minor: number
        }
        Returns: string
      }
      server_mark_payment_requires_review: {
        Args: {
          p_application_fee_amount_minor: number
          p_application_fee_id: string
          p_balance_transaction_id: string
          p_charge_id: string
          p_checkout_session_id: string
          p_currency: string
          p_customer_id: string
          p_destination_account_id: string
          p_failure_code: string
          p_mode: string
          p_order_id: string
          p_payment_intent_id: string
          p_payment_status: string
          p_stripe_event_id: string
          p_subtotal_minor: number
          p_total_minor: number
          p_transfer_id: string
        }
        Returns: {
          order_id: string
          order_status: string
          ticket_status: string
        }[]
      }
      server_persist_connect_status_if_current: {
        Args: {
          p_currently_due_count: number
          p_last_status_code: string
          p_past_due_count: number
          p_payouts_status: string
          p_refresh_sequence: number
          p_requirements_status: string
          p_stripe_account_id: string
          p_transfers_status: string
        }
        Returns: {
          last_synced_at: string
          persistence_result: string
        }[]
      }
      server_prepare_whole_order_refund: {
        Args: { p_order_id: string; p_reason: string }
        Returns: {
          application_fee_amount_minor: number
          application_fee_id: string
          charge_id: string
          currency: string
          order_id: string
          payment_intent_id: string
          reason: string
          total_minor: number
          transfer_id: string
        }[]
      }
      server_record_webhook_receipt: {
        Args: {
          p_api_version: string
          p_event_type: string
          p_livemode: boolean
          p_payload_sha256: string
          p_stripe_created_at: string
          p_stripe_event_id: string
          p_stripe_object_id: string
        }
        Returns: {
          delivery_attempt_count: number
          processing_status: string
          should_process: boolean
        }[]
      }
      server_reserve_checkout:
        | {
            Args: {
              p_client_request_id: string
              p_confirmation_token_hash: string
              p_email: string
              p_event_id: string
              p_items: Json
              p_name: string
            }
            Returns: {
              application_fee_amount_minor: number
              checkout_expires_at: string
              create_request_digest: string
              currency: string
              existing_checkout_session_id: string
              expected_organizer_proceeds_minor: number
              integration_identifier: string
              order_id: string
              order_items: Json
              organizer_id: string
              platform_product_fee_minor: number
              quantity: number
              stripe_account_id: string
              stripe_fee_estimate_minor: number
              subtotal_minor: number
              total_minor: number
            }[]
          }
        | {
            Args: {
              p_client_request_id: string
              p_confirmation_token_hash: string
              p_email: string
              p_event_id: string
              p_name: string
              p_tier_id: string
            }
            Returns: {
              application_fee_amount_minor: number
              checkout_expires_at: string
              create_request_digest: string
              currency: string
              existing_checkout_session_id: string
              integration_identifier: string
              order_id: string
              organizer_id: string
              stripe_account_id: string
              subtotal_minor: number
            }[]
          }
      server_submit_event_report: {
        Args: {
          p_event_id: string
          p_network_fingerprint: string
          p_reason: string
          p_reporter_fingerprint: string
        }
        Returns: string
      }
      withdraw_event_review: { Args: { p_event_id: string }; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
