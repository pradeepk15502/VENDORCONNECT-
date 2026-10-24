output "media_bucket_name" {
  value = aws_s3_bucket.media.bucket
}

output "media_bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "web_bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "web_bucket_regional_domain_name" {
  value = aws_s3_bucket.web.bucket_regional_domain_name
}

output "admin_bucket_name" {
  value = aws_s3_bucket.admin.bucket
}

output "admin_bucket_arn" {
  value = aws_s3_bucket.admin.arn
}

output "admin_bucket_regional_domain_name" {
  value = aws_s3_bucket.admin.bucket_regional_domain_name
}
