FROM owasp/modsecurity-crs@sha256:fd02f0ef154ebb877d029a70d9adf10274868ee3af72b44f093beeebe3bc55ff

# The reviewed template owns both IPv4 and IPv6 listeners. The base image's
# generic listener rewrite is unnecessary and has stalled on some supervised
# Compose hosts before Nginx could bind its health endpoint.
USER root
RUN rm /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
USER nginx

COPY --chmod=0444 default.conf.template /etc/nginx/templates/conf.d/default.conf.template
COPY --chmod=0444 logging.conf.template /etc/nginx/templates/conf.d/logging.conf.template
