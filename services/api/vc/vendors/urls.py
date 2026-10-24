from django.urls import path, re_path

from . import views

urlpatterns = [
    path("vendors", views.VendorCollectionView.as_view(), name="vendor-create"),
    path("vendors/me", views.MyVendorView.as_view(), name="vendor-me"),
    path("vendors/me/summary", views.VendorSummaryView.as_view(), name="vendor-summary"),
    path("vendors/me/status", views.ShopStatusView.as_view(), name="vendor-status"),
    path("vendors/me/delivery", views.DeliverySettingsView.as_view(), name="vendor-delivery"),
    re_path(
        r"^vendors/(?P<handle>@?[A-Za-z0-9]{3,16})/products$",
        views.VendorProductsPublicView.as_view(),
        name="vendor-products-public",
    ),
    re_path(r"^vendors/(?P<handle>@?[A-Za-z0-9]{3,16})$", views.VendorByHandleView.as_view(), name="vendor-by-handle"),
    # Admin (Phase 11, ARCHITECTURE D32)
    path("admin/vendors", views.AdminVendorListView.as_view(), name="admin-vendor-list"),
    re_path(
        r"^admin/vendors/(?P<handle>@?[A-Za-z0-9]{3,16})$",
        views.AdminVendorDetailView.as_view(),
        name="admin-vendor-detail",
    ),
    re_path(
        r"^admin/vendors/(?P<handle>@?[A-Za-z0-9]{3,16})/verify$",
        views.AdminVendorVerifyView.as_view(),
        name="admin-vendor-verify",
    ),
    re_path(
        r"^admin/vendors/(?P<handle>@?[A-Za-z0-9]{3,16})/suspend$",
        views.AdminVendorSuspendView.as_view(),
        name="admin-vendor-suspend",
    ),
    re_path(
        r"^admin/vendors/(?P<handle>@?[A-Za-z0-9]{3,16})/restore$",
        views.AdminVendorRestoreView.as_view(),
        name="admin-vendor-restore",
    ),
]
