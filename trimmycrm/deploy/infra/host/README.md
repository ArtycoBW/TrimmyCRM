# Подготовка production-хоста

Для VM с 4 ГБ RAM включите 2 ГБ swap до первого production-деплоя:

```sh
SWAP_SIZE_MB=2048 sh deploy/infra/host/enable-swap.sh
```

Скрипт нужно выполнять один раз от `root`. Он создаёт `/swapfile`, добавляет точную запись в `/etc/fstab` и устанавливает `vm.swappiness=10`; повторный запуск безопасен.
