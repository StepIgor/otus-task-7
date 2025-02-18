В Dockerhub по каждому сервису предусмотрено два контейнера (задаётся через tag):

1. **:latest**, собранные под amd64-архитектуру;
2. **:arm**, собранные под arm64 (M-процессоры Apple);
   
В deploy-манифесты репозитория по умолчанию включены latest-варианты образов.

**Порядок установки** (предлагается default namespace, однако можно указать и свой):
1. Разворачиваем PostgreSQL. Для облегчения отладки используется один инстанс базы, где каждый сервис ведёт свою табличку, однако можно свободно развернуть N-ое кол-во, заодно подкорректировав хост базы в configmap каждого из сервисов и указав новые хосты в job на миграцию:
   ```
   helm install postgresql bitnami/postgresql -f postgre_values.yaml
   ```
2. Разворачиваем RabbitMQ.
   ```
   helm install rabbitmq bitnami/rabbitmq -f rabbitmq_values.yaml
   ```
3. В директории manifests применяем все манифесты одной командой (секрет для базы, миграция, configmap + deploy + service по каждому сервису, ingress):
   ```
   kubectl apply -f .
   ```

**Сервисы станут доступны по адресам:**
arch.homework/(users|orders|billing|notifications)
