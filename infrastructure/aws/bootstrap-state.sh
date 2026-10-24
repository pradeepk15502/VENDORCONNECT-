#!/usr/bin/env bash
# One-time, per-AWS-account setup: creates the S3 bucket + DynamoDB lock table Terraform's own
# state backend needs. A backend can't create itself (chicken-and-egg), so this is a plain script,
# not a Terraform module — run it once by hand, with real AWS credentials, before the first
# `terraform init` in either environment.
#
# Usage: ./bootstrap-state.sh <bucket-name> <region>
# Example: ./bootstrap-state.sh vendorconnect-tfstate-a1b2c3 ap-south-1

set -euo pipefail

BUCKET="${1:?usage: $0 <bucket-name> <region>}"
REGION="${2:?usage: $0 <bucket-name> <region>}"
LOCK_TABLE="vendorconnect-tfstate-lock"

echo "Creating state bucket: s3://${BUCKET} (${REGION})"
if [ "${REGION}" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}"
else
  aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
    --create-bucket-configuration "LocationConstraint=${REGION}"
fi

aws s3api put-bucket-versioning --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "Creating lock table: ${LOCK_TABLE}"
aws dynamodb create-table \
  --table-name "${LOCK_TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "${REGION}"

cat <<EOF

Done. Put these in environments/<env>/backend.hcl (copy from backend.hcl.example):
  bucket         = "${BUCKET}"
  key            = "<env>/terraform.tfstate"
  region         = "${REGION}"
  dynamodb_table = "${LOCK_TABLE}"
  encrypt        = true

Then: terraform init -backend-config=backend.hcl
EOF
