-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending', 'suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'manager', 'executive');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('upi_gateway', 'qr_utr');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'email', 'whatsapp');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "employee_id" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_district_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "district_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_district_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_statuses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "color_code" TEXT,
    "requires_note" BOOLEAN NOT NULL DEFAULT false,
    "requires_document" BOOLEAN NOT NULL DEFAULT false,
    "notify_customer" BOOLEAN NOT NULL DEFAULT false,
    "notification_template_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_transitions" (
    "id" UUID NOT NULL,
    "from_status_id" UUID NOT NULL,
    "to_status_id" UUID NOT NULL,

    CONSTRAINT "lead_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "external_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "monthly_bill" DECIMAL(12,2),
    "district_id" UUID NOT NULL,
    "state" TEXT,
    "installation_type" TEXT,
    "message" TEXT,
    "current_status_id" UUID NOT NULL,
    "assigned_executive_id" UUID,
    "assigned_manager_id" UUID,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "source_ip" TEXT,
    "recaptcha_score" DECIMAL(5,4),
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_timestamp" TIMESTAMP(3),
    "is_overdue" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_history" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status_id" UUID,
    "to_status_id" UUID NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_details" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "gender" TEXT,
    "father_husband_name" TEXT,
    "aadhaar_encrypted" TEXT,
    "pan_encrypted" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "village_locality" TEXT,
    "pincode" TEXT,
    "district_id" UUID,
    "alternate_phone" TEXT,
    "property_ownership" TEXT,
    "roof_area" DECIMAL(12,2),
    "recommended_capacity" DECIMAL(10,2),
    "shadow_free_area" DECIMAL(12,2),
    "roof_type" TEXT,
    "verified_monthly_bill" DECIMAL(12,2),
    "connection_type" TEXT,
    "consumer_number" TEXT,
    "discom_name" TEXT,
    "bank_account_encrypted" TEXT,
    "bank_name" TEXT,
    "ifsc_code" TEXT,
    "account_holder_name" TEXT,
    "loan_required" BOOLEAN NOT NULL DEFAULT false,
    "loan_amount_required" DECIMAL(12,2),
    "preferred_lender" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_user_id" UUID,
    "review_status" "DocumentReviewStatus" NOT NULL DEFAULT 'pending',
    "review_notes" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "gateway_order_id" TEXT,
    "gateway_payment_id" TEXT,
    "utr_number" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "collected_by_user_id" UUID,
    "verified_by_user_id" UUID,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template_id" UUID,
    "recipient" TEXT NOT NULL,
    "content_sent" TEXT NOT NULL,
    "delivery_status" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempted_at" TIMESTAMP(3),

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_details" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "lender_name" TEXT NOT NULL,
    "application_number" TEXT,
    "applied_amount" DECIMAL(12,2),
    "approved_amount" DECIMAL(12,2),
    "application_status" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "disbursed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "details_json" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "districts_state_is_active_idx" ON "districts"("state", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "districts_name_state_key" ON "districts"("name", "state");

-- CreateIndex
CREATE INDEX "user_district_assignments_district_id_idx" ON "user_district_assignments"("district_id");

-- CreateIndex
CREATE INDEX "user_district_assignments_user_id_idx" ON "user_district_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_district_assignments_user_id_district_id_key" ON "user_district_assignments"("user_id", "district_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_statuses_name_key" ON "lead_statuses"("name");

-- CreateIndex
CREATE INDEX "lead_statuses_order_index_idx" ON "lead_statuses"("order_index");

-- CreateIndex
CREATE INDEX "lead_statuses_is_terminal_idx" ON "lead_statuses"("is_terminal");

-- CreateIndex
CREATE INDEX "lead_status_transitions_from_status_id_idx" ON "lead_status_transitions"("from_status_id");

-- CreateIndex
CREATE INDEX "lead_status_transitions_to_status_id_idx" ON "lead_status_transitions"("to_status_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_status_transitions_from_status_id_to_status_id_key" ON "lead_status_transitions"("from_status_id", "to_status_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_external_id_key" ON "leads"("external_id");

-- CreateIndex
CREATE INDEX "leads_district_id_idx" ON "leads"("district_id");

-- CreateIndex
CREATE INDEX "leads_current_status_id_idx" ON "leads"("current_status_id");

-- CreateIndex
CREATE INDEX "leads_assigned_executive_id_idx" ON "leads"("assigned_executive_id");

-- CreateIndex
CREATE INDEX "leads_assigned_manager_id_idx" ON "leads"("assigned_manager_id");

-- CreateIndex
CREATE INDEX "leads_district_id_current_status_id_idx" ON "leads"("district_id", "current_status_id");

-- CreateIndex
CREATE INDEX "leads_assigned_executive_id_current_status_id_idx" ON "leads"("assigned_executive_id", "current_status_id");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "lead_status_history_lead_id_idx" ON "lead_status_history"("lead_id");

-- CreateIndex
CREATE INDEX "lead_status_history_lead_id_created_at_idx" ON "lead_status_history"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_status_history_changed_by_user_id_idx" ON "lead_status_history"("changed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_details_lead_id_key" ON "customer_details"("lead_id");

-- CreateIndex
CREATE INDEX "customer_details_district_id_idx" ON "customer_details"("district_id");

-- CreateIndex
CREATE INDEX "customer_details_pincode_idx" ON "customer_details"("pincode");

-- CreateIndex
CREATE INDEX "documents_lead_id_idx" ON "documents"("lead_id");

-- CreateIndex
CREATE INDEX "documents_lead_id_is_latest_idx" ON "documents"("lead_id", "is_latest");

-- CreateIndex
CREATE INDEX "documents_review_status_idx" ON "documents"("review_status");

-- CreateIndex
CREATE INDEX "documents_uploaded_by_user_id_idx" ON "documents"("uploaded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_lead_id_category_version_key" ON "documents"("lead_id", "category", "version");

-- CreateIndex
CREATE INDEX "payments_lead_id_idx" ON "payments"("lead_id");

-- CreateIndex
CREATE INDEX "payments_lead_id_status_idx" ON "payments"("lead_id", "status");

-- CreateIndex
CREATE INDEX "payments_method_idx" ON "payments"("method");

-- CreateIndex
CREATE INDEX "payments_collected_by_user_id_idx" ON "payments"("collected_by_user_id");

-- CreateIndex
CREATE INDEX "payments_verified_by_user_id_idx" ON "payments"("verified_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_name_key" ON "notification_templates"("name");

-- CreateIndex
CREATE INDEX "notification_templates_channel_is_active_idx" ON "notification_templates"("channel", "is_active");

-- CreateIndex
CREATE INDEX "notification_logs_lead_id_created_at_idx" ON "notification_logs"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_channel_created_at_idx" ON "notification_logs"("channel", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_template_id_idx" ON "notification_logs"("template_id");

-- CreateIndex
CREATE INDEX "notification_logs_delivery_status_idx" ON "notification_logs"("delivery_status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_details_lead_id_key" ON "loan_details"("lead_id");

-- CreateIndex
CREATE INDEX "loan_details_application_status_idx" ON "loan_details"("application_status");

-- CreateIndex
CREATE INDEX "loan_details_lender_name_idx" ON "loan_details"("lender_name");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "user_district_assignments" ADD CONSTRAINT "user_district_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_district_assignments" ADD CONSTRAINT "user_district_assignments_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_statuses" ADD CONSTRAINT "lead_statuses_notification_template_id_fkey" FOREIGN KEY ("notification_template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_transitions" ADD CONSTRAINT "lead_status_transitions_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "lead_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_transitions" ADD CONSTRAINT "lead_status_transitions_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "lead_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_current_status_id_fkey" FOREIGN KEY ("current_status_id") REFERENCES "lead_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_executive_id_fkey" FOREIGN KEY ("assigned_executive_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_manager_id_fkey" FOREIGN KEY ("assigned_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "lead_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "lead_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_details" ADD CONSTRAINT "customer_details_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_details" ADD CONSTRAINT "customer_details_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_user_id_fkey" FOREIGN KEY ("collected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_details" ADD CONSTRAINT "loan_details_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

