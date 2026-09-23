from django.urls import path, re_path

from . import views

urlpatterns = [
    path("vendors", views.VendorCreateView.as_view(), name="vendor-create"),
    path("vendors/me", views.MyVendorView.as_view(), name="vendor-me"),
    path("vendors/me/status", views.ShopStatusView.as_view(), name="vendor-status"),
    path("vendors/me/delivery", views.DeliverySettingsView.as_view(), name="vendor-delivery"),
    re_path(r"^vendors/(?P<handle>@?[A-Za-z0-9]{3,16})$", views.VendorByHandleView.as_view(), name="vendor-by-handle"),
]
