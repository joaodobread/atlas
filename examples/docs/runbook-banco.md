# Runbook: manutenção do banco

Antes de qualquer janela de manutenção no MySQL Principal:

1. Avise o time do Java Backoffice.
2. Coloque a Node API em modo somente leitura.
3. Verifique filas acumuladas no RabbitMQ.

## Rollback

Restaure o snapshot mais recente e reprocesse as mensagens pendentes.
