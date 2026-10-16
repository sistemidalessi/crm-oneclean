# Serviço fiscal da OneClean — instalação na VPS da Agilité

O serviço fiscal emite a NF-e da OneClean **direto na Sefaz-SP**, assinando com o certificado A1. Ele roda na
mesma VPS do sistema da Agilité (Vultr, Ubuntu 24.04, IP `216.128.169.101`), **separado** dele: outro usuário
(`oneclean-fiscal`), outra pasta (`/opt/oneclean-fiscal`), outra porta (8787), outro endereço
(`fiscal.oneclean.com.br`). O CRM fala com ele só pela Edge Function `crm-fiscal` do Supabase, com uma chave própria.

Regras de segurança (valem para sempre):
- o arquivo `.pfx` e a senha dele **só existem na VPS** — nunca no repositório, no CRM, no e-mail ou no chat;
- a chave `FISCAL_TOKEN` é gerada na VPS e colada **só** nos Secrets do Supabase (nunca no chat);
- o serviço só escuta em `127.0.0.1`; quem atende a internet é o Caddy, com HTTPS;
- a conferência do certificado da Sefaz nunca é desligada.

**Onde fazer:** no **computador do escritório** — é o único com a chave SSH da VPS. Abrir o **PowerShell**.
Os textos depois de `#` são comentários: pode colar junto, não fazem nada.

## 1. Endereço `fiscal` (painel do UOL Host, DNS do `oneclean.com.br`)

Painel do UOL Host → Domínios → `oneclean.com.br` → Gerenciar DNS → Adicionar registro:

```
Tipo: A    Nome: fiscal    Valor: 216.128.169.101    TTL: o que vier (3600)
```

Leva de alguns minutos a algumas horas para valer. Para conferir, no PowerShell:
`nslookup fiscal.oneclean.com.br` tem de responder `216.128.169.101`. Dá para seguir os passos 2 a 5 enquanto isso.

## 2. Entrar na VPS

```powershell
ssh root@216.128.169.101
```

O começo da linha muda para `root@...:~#`. Daqui até o passo 6 os comandos são **na VPS**.

## 3. Preparar (na VPS)

```bash
apt update && apt install -y libxml2-utils openssl git
node -v                                   # tem de ser v22 ou mais (o mesmo da Agilité)
adduser --system --group --no-create-home oneclean-fiscal
git clone https://github.com/sistemidalessi/crm-oneclean.git /opt/oneclean-fiscal
mkdir -p /var/lib/oneclean-fiscal /etc/oneclean-fiscal /etc/caddy/conf.d
chown oneclean-fiscal:oneclean-fiscal /var/lib/oneclean-fiscal
chmod 750 /var/lib/oneclean-fiscal
```

## 4. Certificado A1

**4a. Copiar o arquivo** — num **segundo PowerShell** do computador (não o que está na VPS), trocando o caminho
pelo do arquivo `.pfx` da OneClean:

```powershell
scp "C:\caminho\do\certificado-oneclean.pfx" root@216.128.169.101:/etc/oneclean-fiscal/oneclean.pfx
```

**4b. Guardar a senha** — de volta na VPS. O primeiro comando fica esperando: digite a senha do certificado e
Enter (ela **não aparece** na tela e não fica no histórico):

```bash
read -rs SENHA && printf '%s' "$SENHA" > /etc/oneclean-fiscal/senha.txt && unset SENHA
chown root:oneclean-fiscal /etc/oneclean-fiscal/oneclean.pfx /etc/oneclean-fiscal/senha.txt
chmod 640 /etc/oneclean-fiscal/oneclean.pfx /etc/oneclean-fiscal/senha.txt
ls -l /etc/oneclean-fiscal                # os dois arquivos, "-rw-r----- root oneclean-fiscal"
```

## 5. Configuração, chave e diagnóstico (na VPS)

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
unset TOKEN
cd /opt/oneclean-fiscal/servico-fiscal
sudo -u oneclean-fiscal env $(xargs < /etc/oneclean-fiscal.env) node diagnostico.js status homologacao
```

Tem de mostrar o titular (OneClean e o CNPJ), a validade do certificado e `107 — Servico em Operacao`.

- `Falhou: ... mac verify failure` ou `invalid password`: a senha ficou errada; repita o 4b.
- `Falhou: ... unable to get local issuer certificate` (ou `unable to verify the first certificate`): o Node não
  conhece a autoridade da ICP-Brasil que assina o servidor da Sefaz. Instalar a cadeia (o serviço **soma** essa
  cadeia às autoridades normais; nunca desligar a conferência):

  ```bash
  apt install -y unzip
  cd /tmp && rm -rf icp && mkdir icp && cd icp
  curl -fsSLO https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip
  unzip -q ACcompactado.zip
  for f in $(find . -type f \( -iname '*.crt' -o -iname '*.cer' -o -iname '*.pem' \)); do
    openssl x509 -in "$f" -inform DER -outform PEM 2>/dev/null || openssl x509 -in "$f" -outform PEM 2>/dev/null
  done > /etc/oneclean-fiscal/cadeia.pem
  grep -c "BEGIN CERTIFICATE" /etc/oneclean-fiscal/cadeia.pem     # dezenas de certificados
  echo "FISCAL_CA=/etc/oneclean-fiscal/cadeia.pem" >> /etc/oneclean-fiscal.env
  cd /opt/oneclean-fiscal/servico-fiscal
  sudo -u oneclean-fiscal env $(xargs < /etc/oneclean-fiscal.env) node diagnostico.js status homologacao
  ```

## 6. Ligar o serviço e o endereço (na VPS)

```bash
cp /opt/oneclean-fiscal/servico-fiscal/instalar/oneclean-fiscal.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now oneclean-fiscal
systemctl status oneclean-fiscal --no-pager        # "active (running)"
# Caddy: o bloco do fiscal fica em conf.d. A linha "import" é a mesma que o deploy/Caddyfile da Agilité já tem
# desde 16/10/2026 (commit 03bdfbd); aqui ela entra só no arquivo ativo, sem mexer no sistema da Agilité.
cp /opt/oneclean-fiscal/servico-fiscal/instalar/Caddyfile.trecho /etc/caddy/conf.d/oneclean-fiscal.caddy
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes-do-fiscal
grep -q 'conf.d' /etc/caddy/Caddyfile || sed -i '1i import /etc/caddy/conf.d/*.caddy' /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -s -o /dev/null -w "%{http_code}\n" https://sistema.agiliteservice.com.br/   # a Agilité continua: 200 ou 302
curl -s https://fiscal.oneclean.com.br/saude        # {"erro":"sem autorização"} = no ar e protegido
```

Se o `caddy validate` reclamar: `cp /etc/caddy/Caddyfile.antes-do-fiscal /etc/caddy/Caddyfile` volta como estava
(a Agilité não para: o reload só acontece se a validação passar). O `curl` do fiscal só funciona depois que o DNS do passo 1 valer (o Caddy tira o certificado HTTPS sozinho na 1ª visita).

**Antes de sair**, mostrar a chave para o passo 7 (fica só na tela; fechar a janela depois):

```bash
grep FISCAL_TOKEN /etc/oneclean-fiscal.env | cut -d= -f2
```

## 7. Supabase (Secrets das Edge Functions)

https://supabase.com/dashboard/project/udhigavckigciqnicgyy/functions/secrets → "Add new secret", um de cada vez:

- `FISCAL_URL` = `https://fiscal.oneclean.com.br`
- `FISCAL_TOKEN` = o valor que o comando acima mostrou (64 letras e números, sem espaço)

Salvar. Pronto: no CRM, aba **Fiscal → 4. Emissão → "Conferir o serviço fiscal"** e **"Status da Sefaz"**.

## Dia a dia

- **Atualizar o código:** `cd /opt/oneclean-fiscal && git pull && systemctl restart oneclean-fiscal`
- **Certificado renovado:** copiar o `.pfx` novo por cima (passo 4a), refazer a senha (4b) se mudou e
  `systemctl reload oneclean-fiscal` — o CRM avisa (aba Fiscal → "Conferir o serviço fiscal") quando faltam menos
  de 30 dias.
- **Cópia dos XML:** ficam em `/var/lib/oneclean-fiscal/AAAA-MM/` (além do CRM). Entram no backup da VPS.
- **Ver o que aconteceu:** `journalctl -u oneclean-fiscal -n 100 --no-pager`
- **Caddy da Agilité mudou:** continua igual (`cp deploy/Caddyfile /etc/caddy/Caddyfile`); o bloco do fiscal mora
  em `/etc/caddy/conf.d/oneclean-fiscal.caddy` e não se perde.
