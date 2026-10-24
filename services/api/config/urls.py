from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

# Phase 12 hardening (vc/core/exceptions.py): keeps unhandled 500s on the API surface in this
# project's own {"error": {...}} envelope instead of Django's default HTML error page.
handler500 = "vc.core.exceptions.handler500"

urlpatterns = [
    path("", include("vc.core.urls")),
    path("django-admin/", admin.site.urls),
    path("api/v1/", include("vc.accounts.urls")),
    path("api/v1/", include("vc.vendors.urls")),
    path("api/v1/", include("vc.catalog.urls")),
    path("api/v1/", include("vc.chat.urls")),
    path("api/v1/", include("vc.orders.urls")),
    path("api/v1/", include("vc.notifications.urls")),
    path("api/v1/", include("vc.assets.urls")),
    path("api/v1/", include("vc.social.urls")),
    path("api/v1/", include("vc.moderation.urls")),
    path("api/v1/", include("vc.ai.urls")),
    path("api/v1/", include("vc.audit.urls")),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

if settings.DEBUG:
    # Dev-only local media serving (ARCHITECTURE D12) — production points MEDIA_URL at a real
    # object-storage/CDN origin instead, so this route never exists there (prod.py never sets DEBUG).
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
