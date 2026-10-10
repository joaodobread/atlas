# Node API

Serviço principal em Node/Express que expõe a API de usuários e pedidos.

## Usuários

O endpoint `GET /users` é atendido pelo UsersModule. A leitura acontece no
UserRepository, que consulta a tabela `users` no MySQL Principal.

Se o MySQL Principal ficar indisponível, o login do Java Backoffice também para,
porque o NodeApiClient depende de `GET /users`.

## Pedidos

O OrdersModule grava pedidos na tabela `orders` e publica o evento `order.created`
no RabbitMQ para o faturamento consumir.
