from django.urls import path

from . import views

urlpatterns = [
    path("cart", views.CartView.as_view(), name="cart"),
    path("cart/items/<uuid:item_id>", views.CartItemDetailView.as_view(), name="cart-item-detail"),
    path("checkout/summary", views.CheckoutSummaryView.as_view(), name="checkout-summary"),
    path("checkout", views.CheckoutView.as_view(), name="checkout"),
    path("orders", views.OrderCollectionView.as_view(), name="order-collection"),
    path("orders/<uuid:order_id>", views.OrderDetailView.as_view(), name="order-detail"),
    path("orders/<uuid:order_id>/transition", views.OrderTransitionView.as_view(), name="order-transition"),
    path("orders/<uuid:order_id>/reviews", views.OrderReviewView.as_view(), name="order-review"),
    # Admin (Phase 11, ARCHITECTURE D32)
    path("admin/orders", views.AdminOrderListView.as_view(), name="admin-order-list"),
    path("admin/orders/<uuid:order_id>", views.AdminOrderDetailView.as_view(), name="admin-order-detail"),
]
