param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Target
@{ valid = ($signature.Status -eq 'Valid'); timestamped = ($null -ne $signature.TimeStamperCertificate); signerThumbprint = $signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress
