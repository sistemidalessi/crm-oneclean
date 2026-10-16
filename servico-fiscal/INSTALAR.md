# Serviço fiscal da OneClean — instalação na VPS da Agilité

O serviço fiscal emite a NF-e da OneClean **direto na Sefaz-SP**, assinando com o certificado A1. Ele roda na
mesma VPS do sistema da Agilité (Vultr, Ubuntu), **separado** dele: outro usuário, outra pasta, outra porta, outro
endereço. O CRM fala com ele só pela Edge Function `crm-fiscal` do Supabase, com uma chave própria.

Regras de segurança (valem para sempre):
- o arquivo `.pfx` e a senha dele **só existem na VPS** — nunca no repositório, no CRM, no e-mail ou no chat;
- a chave `FISCAL_TOKEN` é gerada na VPS e colada **só** nos Secrets do Supabase;
- o serviço só escuta em `127.0.0.1`; quem atende a internet é o Caddy, com HTTPS.

## 1. Endereço (no painel do UOL Host, DNS do `oneclean.com.br`)

```
Tipo: A    Nome: fiscal    Valor: <IP da VPS da Agilité>
```

## 2. Na VPS (SSH como root)

```bash
apt install -y libxml2-utils openssl git          # xmllint e openssl (a Agilité já tem; não faz mal repetir)
adduser --system --group --no-create-home oneclean-fiscal
git clone https://github.com/sistemidalessi/crm-oneclean.git /opt/oneclean-fiscal
mkdir -p /var/lib/oneclean-fiscal /etc/oneclean-fiscal
chown oneclean-fiscal:oneclean-fiscal /var/lib/oneclean-fiscal
```

## 3. Certificado A1 (do seu computador para a VPS)

No PowerShell do seu computador (troque o caminho do arquivo):

```powershell
scp "C:\caminho\do\certificado-oneclean.pfx" root@<IP da VPS>:/etc/oneclean-fiscal/oneclean.pfx
```

Na VPS, a senha vai num arquivo (digite quando o `read` pedir; ela não aparece na tela nem fica no histórico):

```bash
read -rs SENHA && printf '%s' "$SENHA" > /etc/oneclean-fiscal/senha.txt && unset SENHA
chown root:oneclean-fiscal /etc/oneclean-fiscal/oneclean.pfx /etc/oneclean-fiscal/senha.txt
chmod 640 /etc/oneclean-fiscal/oneclean.pfx /etc/oneclean-fiscal/senha.txt
```

## 4. Configuração e chave

```bash
TOKEN=$(openssl rand -hex 32)
cat > /etc/oneclean-fiscal.env <<EOF
FISCAL_TOKEN=$TOKEN
FISCAL_PFX=/etc/oneclean-fiscal/oneclean.pfx
FISCAL_PFX_SENHA_ARQUIVO=/etc/oneclean-fiscal/senha.txt
FISCAL_PASTA=/var/lib/oneclean-fiscal
FISCAL_PORTA=8787
EOF
chmod 600 /etc/oneclean-fiscal.env
echo "$TOKEN"     # copie este valor para os Secrets do Supabase (passo 7) e feche o terminal
```

## 5. Diagnóstico (antes de ligar o serviço)

```bash
cd /opt/oneclean-fiscal/servico-fiscal
sudo -u oneclean-fiscal env $(xargs < /etc/oneclean-fiscal.env) node diagnostico.js status homologacao
```

Tem de mostrar o titular (OneClean), a validade do certificado e `107 — Servico em Operacao`.
Se der `unable to get local issuer certificate`: a cadeia do servidor da Sefaz não está no Node. Baixe a cadeia
da ICP-Brasil no site do ITI, salve em `/etc/oneclean-fiscal/cadeia.pem`, acrescente
`FISCAL_CA=/etc/oneclean-fiscal/cadeia.pem` no `.env` e rode de novo. **Nunca** desligue a conferência.

## 6. Ligar o serviço e o endereço

```bash
cp /opt/oneclean-fiscal/servico-fiscal/instalar/oneclean-fiscal.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now oneclean-fiscal
systemctl status oneclean-fiscal --no-pager
cat /opt/oneclean-fiscal/servico-fiscal/instalar/Caddyfile.trecho >> /etc/caddy/Caddyfile
systemctl reload caddy
```

## 7. Supabase (painel → Edge Functions → Secrets)

- `FISCAL_URL` = `https://fiscal.oneclean.com.br`
- `FISCAL_TOKEN` = o valor do passo 4

## Dia a dia

- **Atualizar o código:** `cd /opt/oneclean-fiscal && git pull && systemctl restart oneclean-fiscal`
- **Certificado renovado:** trocar o `oneclean.pfx` (e a `senha.txt`, se mudou) e `systemctl reload oneclean-fiscal`
  — o CRM avisa (aba Fiscal → "Conferir o serviço fiscal") quando faltam menos de 30 dias.
- **Cópia dos XML:** ficam em `/var/lib/oneclean-fiscal/AAAA-MM/` (além do CRM). Entram no backup da VPS.
- **Ver o que aconteceu:** `journalctl -u oneclean-fiscal -n 100 --no-pager`
