output "worker_name" {
  description = "Name of the deployed docs Worker."
  value       = cloudflare_workers_script.docs.script_name
}
